import express from 'express';
import cors from 'cors';
import runsRouter from './routes/runs.js';

// Build the Express app (no listen, no DB connect) so it can be reused by
// server.js (local) and api/index.js (Vercel serverless handler).
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
