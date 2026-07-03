// Vercel serverless entry point. All /api/* requests are rewritten here
// (see vercel.json). The Mongo connection is cached across warm invocations.
const { createApp } = require('../src/app');
const { connectDB } = require('../src/db');

let dbPromise;
function ensureDB() {
  if (!dbPromise) dbPromise = connectDB();
  return dbPromise;
}

const app = createApp();

module.exports = async (req, res) => {
  await ensureDB();
  return app(req, res);
};
