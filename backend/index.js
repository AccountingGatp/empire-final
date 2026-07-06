import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import config from './src/config.js';
import { connectDB } from './src/db.js';
import runsRouter from './src/routes/runs.js';

// Build the Express app (no listen, no DB connect) so it can be reused by the
// local server and the serverless handler.
export function createApp() {
  const app = express();
  app.use(cors()); // allow all origins
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', runsRouter);

  // Fallback error handler.
  app.use((err, _req, res, _next) => {
    console.error('[error]', err);
    res.status(500).json({ error: err.message || 'internal error' });
  });

  return app;
}

// Lazily build the app + connect Mongo, cached across warm invocations.
let app;
let dbPromise;
async function ensureReady() {
  if (!app) app = createApp();
  if (!dbPromise) {
    // Cache the promise so warm invocations reuse the connection, but clear it
    // on failure so the next request can retry (don't poison the cache).
    dbPromise = connectDB().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  await dbPromise;
}

// Default export = a request handler, so this file is a valid serverless
// function entry (Vercel requires the default export to be a function/server).
export default async function handler(req, res) {
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
}

// Only listen when run directly (`node index.js` / `npm start`); importing this
// file (serverless) just uses the default handler above.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  ensureReady()
    .then(() => {
      app.listen(config.port, () => {
        console.log(`[server] listening on http://localhost:${config.port}`);
      });
    })
    .catch((err) => {
      console.error('[server] failed to start', err);
      process.exit(1);
    });
}
