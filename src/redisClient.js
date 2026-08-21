const { createClient } = require("redis");

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
// redis.on('error', (err) => console.error('[Redis] client error', err.message));

async function connectRedis() {
  await redis.connect();
  console.log(
    `[Redis] connected -> ${process.env.REDIS_URL || "redis://localhost:6379"}`,
  );
}

module.exports = { redis, connectRedis };
