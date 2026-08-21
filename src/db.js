const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
let db;

async function connectMongo() {
  await client.connect();
  db = client.db(process.env.MONGO_DB_NAME || 'cache_demo');
  console.log(`[MongoDB] connected -> ${process.env.MONGO_URL || 'mongodb://localhost:27017'}`);
  return db;
}

function getDb() {
  if (!db) throw new Error('MongoDB is not connected yet');
  return db;
}

module.exports = { connectMongo, getDb, client };
