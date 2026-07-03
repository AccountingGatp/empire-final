require('dotenv').config();
const path = require('path');

const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  mongoUri:
    process.env.MONGODB_URI ||
    'mongodb+srv://diwakar_db_user:qwertyuiop@cluster0.dble07g.mongodb.net/empire_final',

  xola: {
    apiKey:
      process.env.XOLA_API_KEY || 'B8z3DwdRk-iPtcW0g5E5OA8_37nfYjiWJDwtQ8F5OAQ',
    base: process.env.XOLA_BASE || 'https://xola.com/api',
  },

  // How many delegators (sellers) to pull from Xola.
  delegatorLimit: Number(process.env.DELEGATOR_LIMIT) || 500,
  // How many file exports to process at once.
  concurrency: Number(process.env.CONCURRENCY) || 4,
  // Job polling.
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 3000,
  pollMaxAttempts: Number(process.env.POLL_MAX_ATTEMPTS) || 40,

  // Delay between a seller's two export creations. Xola names the S3 file
  // <sellerEmail>_<timestamp-to-second> with NO report-type marker, so two
  // exports created in the same second collide. Stagger keeps them distinct.
  exportStaggerMs: Number(process.env.EXPORT_STAGGER_MS) || 2000,

  // Where downloaded workbooks are stored (per run).
  storageDir: path.join(__dirname, '..', 'storage'),
};

module.exports = config;
