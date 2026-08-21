// Sample product catalog. Fixed, human-friendly ids (p1..p5) make it easy to
// reference the same product across curl commands.
const PRODUCTS = [
  { _id: 'p1', name: 'Wireless Mouse', category: 'Electronics', price: 24.99, stock: 150 },
  { _id: 'p2', name: 'Mechanical Keyboard', category: 'Electronics', price: 89.5, stock: 60 },
  { _id: 'p3', name: 'USB-C Hub', category: 'Electronics', price: 39.0, stock: 200 },
  { _id: 'p4', name: 'Standing Desk Mat', category: 'Office', price: 45.0, stock: 80 },
  { _id: 'p5', name: 'Ceramic Coffee Mug', category: 'Home', price: 12.75, stock: 300 },
];

async function seedProducts(db) {
  const collection = db.collection('products');
  await collection.deleteMany({});
  await collection.insertMany(PRODUCTS.map((p) => ({ ...p, updatedAt: new Date() })));
  console.log(`[Seed] inserted ${PRODUCTS.length} products: ${PRODUCTS.map((p) => p._id).join(', ')}`);
}

// Allow running standalone: `npm run seed`
if (require.main === module) {
  require('dotenv').config();
  const { connectMongo, client } = require('../db');
  connectMongo()
    .then((db) => seedProducts(db))
    .then(() => client.close())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { seedProducts, PRODUCTS };
