// Vercel serverless entry point. All requests are rewritten here (vercel.json).
// The Express app and the Mongo connection are built lazily and cached across
// warm invocations. Any startup failure is returned as a readable 500 instead
// of crashing the invocation (FUNCTION_INVOCATION_FAILED).
const { createApp } = require('../src/app');
const { connectDB } = require('../src/db');

let app;
let dbPromise;

async function ensureReady() {
  if (!app) app = createApp();
  if (!dbPromise) {
    // Cache the promise so warm invocations reuse the connection, but if it
    // rejects, clear it so the next request can retry (don't poison the cache).
    dbPromise = connectDB().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  await dbPromise;
}

module.exports = async (req, res) => {
  try {
    await ensureReady();
  } catch (err) {
    console.error('[api] startup failed:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'Backend not ready',
        detail: err && err.message ? err.message : String(err),
      })
    );
    return;
  }
  return app(req, res);
};
