'use strict';
const { MongoClient } = require('mongodb');
let clientPromise;
async function db() {
  if (!process.env.MONGODB_URI) throw new Error('MongoDB is not configured');
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 10 });
    clientPromise = client.connect();
  }
  const database = (await clientPromise).db(process.env.MONGODB_DB || 'the_smart_pos');
  if (!globalThis.__posIndexesReady) globalThis.__posIndexesReady = Promise.all([
    database.collection('users').createIndex({username:1},{unique:true}),
    database.collection('pos_state').createIndex({_id:1},{unique:true})
  ]);
  await globalThis.__posIndexesReady;
  return database;
}
module.exports = { db };
