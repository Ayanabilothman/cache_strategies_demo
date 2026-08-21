// The "real" database access layer. Every strategy module goes through
// these functions when it needs to talk to MongoDB, so the console logs and
// artificial latency here apply consistently everywhere.
const { randomBytes } = require('crypto');
const { getDb } = require('./db');
const { simulateDbLatency } = require('./latency');

function collection() {
  return getDb().collection('products');
}

function generateProductId() {
  return `p${randomBytes(3).toString('hex')}`;
}

async function findProductById(id) {
  await simulateDbLatency();
  console.log(`  [MongoDB] READ  product "${id}"`);
  return collection().findOne({ _id: id });
}

// Same as findProductById but without the log/latency noise, used internally
// after a write when we already know we're about to hit the DB.
async function findProductByIdRaw(id) {
  return collection().findOne({ _id: id });
}

async function updateProduct(id, updates) {
  await simulateDbLatency();
  console.log(`  [MongoDB] WRITE product "${id}" ->`, updates);
  await collection().updateOne(
    { _id: id },
    { $set: { ...updates, updatedAt: new Date() } }
  );
  return findProductByIdRaw(id);
}

// Inserts a brand new row. Used when a strategy creates the product in
// MongoDB directly (Write-Through, Write-Around).
async function insertProduct(product) {
  await simulateDbLatency();
  console.log(`  [MongoDB] INSERT product "${product._id}" ->`, product);
  await collection().insertOne({ ...product, updatedAt: new Date() });
  return findProductByIdRaw(product._id);
}

// Update-or-insert. Write-Back's flush job uses this because a dirty id may
// be a brand new product that was never written to MongoDB yet (created
// while only in Redis) or an update to a product that already exists there
// -- the flush job doesn't need to know which case it is.
async function upsertProduct(id, updates) {
  await simulateDbLatency();
  console.log(`  [MongoDB] UPSERT product "${id}" ->`, updates);
  await collection().updateOne(
    { _id: id },
    { $set: { ...updates, updatedAt: new Date() } },
    { upsert: true }
  );
  return findProductByIdRaw(id);
}

async function listProducts() {
  return collection().find().sort({ _id: 1 }).toArray();
}

module.exports = {
  findProductById,
  findProductByIdRaw,
  updateProduct,
  insertProduct,
  upsertProduct,
  listProducts,
  generateProductId,
};
