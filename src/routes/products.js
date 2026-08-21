const express = require("express");
const { redis } = require("../redisClient");
const {
  listProducts,
  findProductByIdRaw,
  generateProductId,
} = require("../productRepo");
const { seedProducts } = require("../data/seed");
const { getDb } = require("../db");

const cacheAside = require("../strategies/cacheAside");
const readThrough = require("../strategies/readThrough");
const writeThrough = require("../strategies/writeThrough");
const writeAround = require("../strategies/writeAround");
const writeBack = require("../strategies/writeBack");

const router = express.Router();
router.use((req, res, next) => {
  if (!req.body) req.body = {}; // curl calls with no -d body would otherwise leave this undefined
  next();
});

const STRATEGIES = {
  cacheAside,
  readThrough,
  writeThrough,
  writeAround,
  writeBack,
};
const DEFAULT_PRODUCT = {
  name: "Demo Gadget",
  category: "Electronics",
  price: 19.99,
  stock: 25,
};

async function timed(fn) {
  const start = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - start };
}

async function redisSnapshot(strategyModule, id) {
  const key = strategyModule.cacheKey(id);
  const value = await redis.get(key);
  return {
    key,
    exists: value !== null,
    ttlSeconds: value !== null ? await redis.ttl(key) : null,
    value: value ? JSON.parse(value) : null,
  };
}

function newProductBody(req) {
  const id = req.body.id || generateProductId();
  const { name, category, price, stock } = { ...DEFAULT_PRODUCT, ...req.body };
  return { id, name, category, price, stock };
}

// ---- Plain product listing / seeding (no caching, for a baseline view) ----

router.get("/products", async (req, res) => {
  res.json(await listProducts());
});

router.post("/seed", async (req, res) => {
  await seedProducts(getDb());
  res.json({ ok: true });
});

// ---- Reading strategies: plain GET, one read per call ----
// Call twice to see the story: DELETE /api/cache first (or just hit an id
// that's never been read) for a guaranteed MISS, then call again for a HIT.

router.get("/cache-aside", async (req, res) => {
  const id = req.query.id || "p1";
  const existedBefore = (await redis.exists(cacheAside.cacheKey(id))) === 1;

  const { result, ms } = await timed(() => cacheAside.getProduct(id));
  if (!result) return res.status(404).json({ error: "not found" });

  res.json({
    strategy: "cache-aside",
    productId: id,
    outcome: existedBefore ? "HIT" : "MISS",
    tookMs: ms,
    product: result,
  });
});

router.get("/read-through", async (req, res) => {
  const id = req.query.id || "p2";
  const existedBefore = (await redis.exists(readThrough.cacheKey(id))) === 1;

  const { result, ms } = await timed(() => readThrough.getProduct(id));
  if (!result) return res.status(404).json({ error: "not found" });

  res.json({
    strategy: "read-through",
    productId: id,
    outcome: existedBefore ? "HIT" : "MISS",
    tookMs: ms,
    product: result,
  });
});

// ---- Writing strategies: each call does ONLY the create/insert for that
// strategy. Nothing else is chained after it -- no follow-up update, no
// manual flush. Write-Back's row reaches MongoDB purely via its own
// background flush job (see src/strategies/writeBack.js), on its own
// schedule (WRITE_BACK_FLUSH_INTERVAL_MS) -- this endpoint doesn't force it.

router.post("/write-through", async (req, res) => {
  const product = newProductBody(req);
  const { result, ms } = await timed(() => writeThrough.createProduct(product));
  res.status(201).json({ strategy: "write-through", tookMs: ms, product: result });
});

router.post("/write-around", async (req, res) => {
  const product = newProductBody(req);
  const { result, ms } = await timed(() => writeAround.createProduct(product));
  res.status(201).json({ strategy: "write-around", tookMs: ms, product: result });
});

router.post("/write-back", async (req, res) => {
  const product = newProductBody(req);
  const { result, ms } = await timed(() => writeBack.createProduct(product));
  res.status(201).json({ strategy: "write-back", tookMs: ms, product: result });
});

// ---- Cache clearing (separate from reading, since it's a mutation) ----
// DELETE /api/cache                          -> wipe every demo cache key
// DELETE /api/cache?strategy=cacheAside       -> wipe that strategy's keys
// DELETE /api/cache?strategy=cacheAside&id=p1 -> wipe just that one key

router.delete("/cache", async (req, res) => {
  const { strategy, id } = req.query;

  if (strategy) {
    const strategyModule = STRATEGIES[strategy];
    if (!strategyModule)
      return res.status(400).json({ error: `unknown strategy "${strategy}"` });

    if (id) {
      const deleted = await redis.del(strategyModule.cacheKey(id));
      return res.json({ deleted });
    }

    const keys = await redis.keys(`${strategyModule.NAMESPACE}:product:*`);
    if (keys.length) await redis.del(keys);
    return res.json({ deleted: keys.length });
  }

  const keys = await redis.keys("*:product:*");
  if (keys.length) await redis.del(keys);
  res.json({ deleted: keys.length });
});

// ---- Inspection helpers (used to observe Redis/MongoDB state directly) ----

router.get("/inspect/mongo/:id", async (req, res) => {
  const doc = await findProductByIdRaw(req.params.id);
  if (!doc) return res.status(404).json({ error: "not found" });
  res.json(doc);
});

router.get("/inspect/redis/:id", async (req, res) => {
  const strategyModule = STRATEGIES[req.query.strategy];
  if (!strategyModule) {
    return res.status(400).json({
      error:
        "unknown or missing ?strategy= query param (e.g. cacheAside, readThrough, writeThrough, writeAround, writeBack)",
    });
  }
  res.json(await redisSnapshot(strategyModule, req.params.id));
});

module.exports = router;
