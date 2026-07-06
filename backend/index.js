import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import config from './src/config.js';
import { connectDB } from './src/db.js';
import runsRouter from './src/routes/runs.js';

// Build the Express app (no listen, no DB connect) so it can be reused by the
// local server (below) and the Vercel serverless handler (api/index.js).
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

async function start() {
  await connectDB();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
  });
}

// Only start a listening server when run directly (`node index.js`); importing
// this file (e.g. from the serverless handler) just gives you createApp().
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  start().catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
  });
}
