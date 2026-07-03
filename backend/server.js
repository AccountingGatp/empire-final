const config = require('./src/config');
const { connectDB } = require('./src/db');
const { createApp } = require('./src/app');

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
