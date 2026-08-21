// READ-THROUGH
//
// The application never talks to MongoDB directly -- it only ever calls
// getProduct(id) on the cache. The cache itself is responsible for loading
// missing data (here via the generic `readThrough` helper + a `loader`
// function). In a real system this logic would live inside a caching
// library/proxy sitting in front of the database; the code below plays that
// role so the "who owns the miss?" distinction from Cache-Aside is visible.
const { redis } = require("../redisClient");
const { findProductById } = require("../productRepo");

const NAMESPACE = "read-through";
const TTL_SECONDS = 60;

function cacheKey(id) {
  // read-through:product:101  --> keyname
  return `${NAMESPACE}:product:${id}`;
}

// Generic read-through primitive: caller only ever asks the cache for data,
// and hands it a loader to use in case of a miss. Compare with Cache-Aside,
// where the *caller* runs the miss/load/populate steps itself.
async function readThrough(key, loader) {
  const cached = await redis.get(key);

  if (cached) {
    console.log(`[Read-Through] HIT  ${key}`);
    return JSON.parse(cached);
  }

  console.log(
    `[Read-Through] MISS ${key} -> cache loads from MongoDB on the app's behalf`,
  );
  // cache does nor know anything about what is your database
  // get value from DB
  const value = await loader();

  if (value) {
    // update cache
    await redis.set(key, JSON.stringify(value), { EX: TTL_SECONDS });
    console.log(`[Read-Through] STORE ${key} (TTL ${TTL_SECONDS}s)`);
  }

  return value;
}

// getProduct -> application
async function getProduct(id) {
  // key, loader
  return readThrough(cacheKey(id), () => findProductById(id));
}

module.exports = { getProduct, cacheKey, NAMESPACE };
