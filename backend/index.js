import config from './src/config.js';
import { connectDB } from './src/db.js';
import { createApp } from './src/app.js';

async function start() {
  await connectDB();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
  });
}

start().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});
