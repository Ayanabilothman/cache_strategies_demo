require("dotenv").config();

const express = require("express");
const { connectMongo, getDb } = require("./db");
const { connectRedis } = require("./redisClient");
const { seedProducts } = require("./data/seed");
const productsRouter = require("./routes/products");
const { startFlushInterval } = require("./strategies/writeBack");

const PORT = process.env.PORT || 3000;
const WRITE_BACK_FLUSH_INTERVAL_MS = Number(
  process.env.WRITE_BACK_FLUSH_INTERVAL_MS || 10000,
);

async function main() {
  await connectMongo();
  await connectRedis();

  const db = getDb();
  const existingCount = await db.collection("products").countDocuments();
  if (existingCount === 0) {
    console.log("[Seed] no products found, seeding sample catalog...");
    await seedProducts(db);
  }

  const app = express();
  app.use(express.json());
  app.use("/api", productsRouter);

  app.get("/", (req, res) => {
    res.json({
      ok: true,
      message: "Caching strategies demo API. See README for endpoints.",
    });
  });

  // Simulation for background jobs
  startFlushInterval(WRITE_BACK_FLUSH_INTERVAL_MS);

  app.listen(PORT, () => {
    console.log(`[Server] listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
