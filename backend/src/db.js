const mongoose = require('mongoose');
const config = require('./config');

async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });
  console.log(`[db] connected to MongoDB (${mongoose.connection.name})`);
  return mongoose.connection;
}

module.exports = { connectDB };
