// WRITE-AROUND
//
// Writes go STRAIGHT to MongoDB, completely bypassing Redis. Any existing
// cache entry is invalidated (deleted) rather than updated, so the next read
// is a guaranteed miss that repopulates the cache from the database
// (cache-aside style). This avoids filling the cache with data that may
// never be read again, at the cost of that first read being slow.
const { redis } = require('../redisClient');
const { updateProduct, insertProduct, findProductById, generateProductId } = require('../productRepo');

const NAMESPACE = 'write-around';
const TTL_SECONDS = 60;

function cacheKey(id) {
  return `${NAMESPACE}:product:${id}`;
}

// INSERT: goes straight to MongoDB like every other write-around write.
// There's no existing cache entry to invalidate for a brand new id, so
// unlike updateProductPrice there's no redis.del here -- the point is
// simply that Redis is *never touched* on the way in. The first GET for
// this id will be a genuine miss that populates the cache cache-aside style.
async function createProduct(body) {
  const id = body.id || generateProductId();
  console.log(`[Write-Around] CREATE "${id}" -> MongoDB only, Redis is never primed`);

  return insertProduct({
    _id: id,
    name: body.name,
    category: body.category,
    price: body.price,
    stock: body.stock,
  });
}

async function updateProductPrice(id, updates) {
  console.log(`[Write-Around] WRITE "${id}" -> MongoDB only, Redis is bypassed`);
  const updated = await updateProduct(id, updates);

  const key = cacheKey(id);
  const deleted = await redis.del(key);
  if (deleted) {
    console.log(`[Write-Around] INVALIDATE stale cache entry ${key}`);
  }

  return updated;
}

async function getProduct(id) {
  const key = cacheKey(id);

  const cached = await redis.get(key);
  if (cached) {
    console.log(`[Write-Around] HIT  ${key}`);
    return JSON.parse(cached);
  }

  console.log(`[Write-Around] MISS ${key} -> reading MongoDB (cache-aside style repopulation)`);
  const product = await findProductById(id);
  if (product) {
    await redis.set(key, JSON.stringify(product), { EX: TTL_SECONDS });
  }
  return product;
}

module.exports = { createProduct, updateProductPrice, getProduct, cacheKey, NAMESPACE };
