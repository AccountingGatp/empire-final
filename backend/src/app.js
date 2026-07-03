const express = require('express');
const cors = require('cors');
const config = require('./config');
const runsRouter = require('./routes/runs');

// Build the Express app (no listen, no DB connect) so it can be reused by
// server.js (local) and api/index.js (Vercel serverless handler).
function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
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

module.exports = { createApp };
