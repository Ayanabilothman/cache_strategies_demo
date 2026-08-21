// WRITE-BACK (a.k.a. WRITE-BEHIND)
//
// Writes only touch Redis and return immediately -- MongoDB is NOT updated
// yet. The written key is remembered in a "dirty set". A background job
// (startFlushInterval) periodically drains that set and persists the dirty
// values to MongoDB. This makes writes very fast, at the cost of a window
// where MongoDB is behind Redis and data could be lost if Redis crashed
// before a flush.
const { redis } = require("../redisClient");
const {
  upsertProduct,
  findProductByIdRaw,
  findProductById,
  generateProductId,
} = require("../productRepo");

const NAMESPACE = "write-back";
const DIRTY_SET_KEY = "write-back:dirty-ids";
const TTL_SECONDS = 300;

function cacheKey(id) {
  return `${NAMESPACE}:product:${id}`;
}

// INSERT: the new row is written to Redis only and marked dirty, exactly
// like an update -- it does NOT exist in MongoDB until the next flush. This
// is the clearest demo of write-back's risk: query /inspect/mongo/:id right
// after this call and you'll get a 404, even though the product "exists"
// and is fully readable through the cache.
async function createProduct(body) {
  const id = body.id || generateProductId();
  const created = {
    _id: id,
    name: body.name,
    category: body.category,
    price: body.price,
    stock: body.stock,
    updatedAt: new Date().toISOString(),
  };

  await redis.set(cacheKey(id), JSON.stringify(created), { EX: TTL_SECONDS });

  await redis.sAdd(DIRTY_SET_KEY, String(id));

  // Redis: product102 ---> price: 100
  // dirty key : 102
  // --------------
  // background job after insertion to redis by 10 seconds
  // write to DB
  // new update .. product102 ---> price: 300
  // & remove dirty key

  // task 2: versioning + LUA in Redis

  console.log(
    `[Write-Back] CREATE "${id}" -> Redis only (fast). Row does not exist in MongoDB yet.`,
  );
  return created;
}

async function updateProductPrice(id, updates) {
  const key = cacheKey(id);

  const cachedRaw = await redis.get(key);
  const current = cachedRaw
    ? JSON.parse(cachedRaw)
    : await findProductByIdRaw(id);
  if (!current) return null;

  const updated = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await redis.set(key, JSON.stringify(updated), { EX: TTL_SECONDS });
  await redis.sAdd(DIRTY_SET_KEY, String(id));

  console.log(
    `[Write-Back] WRITE "${id}" -> Redis only (fast). MongoDB write deferred.`,
  );
  return updated;
}

async function getProduct(id) {
  const key = cacheKey(id);

  const cached = await redis.get(key);
  if (cached) {
    console.log(`[Write-Back] HIT  ${key}`);
    return JSON.parse(cached);
  }

  console.log(`[Write-Back] MISS ${key} -> reading MongoDB`);
  const product = await findProductById(id);
  if (product) {
    await redis.set(key, JSON.stringify(product), { EX: TTL_SECONDS });
  }
  return product;
}

// Drains the dirty set and persists each entry to MongoDB. Called on a
// timer, and also exposed via an endpoint so it can be triggered on demand
// during a demo instead of waiting for the interval.
//
// Uses upsertProduct rather than a plain update because a dirty id might be
// an update to a row that already exists in MongoDB, OR a brand new row
// that was created straight into Redis by createProduct() and has never
// been written to MongoDB at all -- the flush job treats both the same way.
async function flushDirty() {
  const ids = await redis.sMembers(DIRTY_SET_KEY);

  if (ids.length === 0) {
    console.log("[Write-Back] FLUSH: nothing dirty, skipping");
    return { flushed: [] };
  }

  console.log(
    `[Write-Back] FLUSH: persisting ${ids.length} dirty product(s) ->`,
    ids,
  );

  for (const id of ids) {
    const raw = await redis.get(cacheKey(id));
    if (!raw) {
      await redis.sRem(DIRTY_SET_KEY, id);
      continue;
    }
    const { _id, ...rest } = JSON.parse(raw);
    await upsertProduct(id, rest); // write database
    await redis.sRem(DIRTY_SET_KEY, id);
  }

  console.log("[Write-Back] FLUSH complete, MongoDB is now up to date");
  return { flushed: ids };
}

function startFlushInterval(ms) {
  setInterval(() => {
    flushDirty().catch((err) =>
      console.error("[Write-Back] flush error:", err.message),
    );
  }, ms);
  console.log(`[Write-Back] background flush job running every ${ms}ms`);
}

module.exports = {
  createProduct,
  updateProductPrice,
  getProduct,
  flushDirty,
  startFlushInterval,
  cacheKey,
  NAMESPACE,
  DIRTY_SET_KEY,
};
