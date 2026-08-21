// CACHE-ASIDE (a.k.a. "lazy loading")
//
// The APPLICATION owns all the caching logic:
//   1. Look in Redis first.
//   2. On a miss, read MongoDB directly.
//   3. Store the result back in Redis for next time.
//
// Writes are not shown here on purpose -- cache-aside says nothing about
// writes. In this demo, updates go through Write-Through/Write-Back/
// Write-Around instead; the read side is what defines cache-aside.
const { redis } = require("../redisClient");
const { findProductById } = require("../productRepo");

const NAMESPACE = "cache-aside";
const TTL_SECONDS = 60;

function cacheKey(id) {
  return `${NAMESPACE}:product:${id}`;
}

async function getProduct(id) {
  const key = cacheKey(id);

  // 1 ask cache
  const cached = await redis.get(key);
  // If Cache HIT return product from cache
  if (cached) {
    console.log(`[Cache-Aside] HIT  ${key}`);
    return JSON.parse(cached);
  }

  // If Cache Miss, ask DB
  console.log(`[Cache-Aside] MISS ${key} -> application reads MongoDB itself`);
  const product = await findProductById(id); // DB

  if (product) {
    // 3 Update cache
    await redis.set(key, JSON.stringify(product), { EX: TTL_SECONDS });
    console.log(`[Cache-Aside] STORE ${key} (TTL ${TTL_SECONDS}s)`);
  }

  return product;
}

module.exports = { getProduct, cacheKey, NAMESPACE };
