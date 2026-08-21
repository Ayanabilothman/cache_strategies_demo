// WRITE-THROUGH
//
// Every write goes to MongoDB AND Redis in the same request, before
// responding to the client. Reads are always served from a warm, consistent
// cache because the cache is never allowed to go stale -- writes keep it in
// lock-step with the database.
const { redis } = require("../redisClient");
const {
  updateProduct,
  insertProduct,
  findProductById,
  generateProductId,
} = require("../productRepo");

const NAMESPACE = "write-through";
const TTL_SECONDS = 60;

function cacheKey(id) {
  return `${NAMESPACE}:product:${id}`;
}

// INSERT: same "through" principle as an update -- the new row goes into
// MongoDB, then Redis is primed immediately so the very first read is
// already a HIT.
async function createProduct(body) {
  const id = body.id || generateProductId();
  console.log(
    `[Write-Through] CREATE "${id}" -> inserting into MongoDB, then priming Redis`,
  );

  // not atomic

  // insert product to DB
  const created = await insertProduct({
    _id: id,
    name: body.name,
    category: body.category,
    price: body.price,
    stock: body.stock,
  });

  // insert product to cache
  await redis.set(cacheKey(id), JSON.stringify(created), { EX: TTL_SECONDS });

  // task 1: outbox pattern 

  console.log(
    `[Write-Through] STORE ${cacheKey(id)} (cache primed on create, no cold read needed)`,
  );

  return created;
}

async function updateProductPrice(id, updates) {
  console.log(
    `[Write-Through] WRITE "${id}" -> writing to MongoDB, then updating Redis`,
  );
  const updated = await updateProduct(id, updates);

  if (updated) {
    await redis.set(cacheKey(id), JSON.stringify(updated), { EX: TTL_SECONDS });
    console.log(
      `[Write-Through] STORE ${cacheKey(id)} (cache now matches the DB)`,
    );
  }

  return updated;
}

async function getProduct(id) {
  const key = cacheKey(id);

  const cached = await redis.get(key);
  if (cached) {
    console.log(`[Write-Through] HIT  ${key}`);
    return JSON.parse(cached);
  }

  console.log(
    `[Write-Through] MISS ${key} -> first read of this id, populating cache`,
  );
  const product = await findProductById(id);
  if (product) {
    await redis.set(key, JSON.stringify(product), { EX: TTL_SECONDS });
  }
  return product;
}

module.exports = {
  createProduct,
  updateProductPrice,
  getProduct,
  cacheKey,
  NAMESPACE,
};
