import 'dotenv/config';

const config = {
  port: Number(process.env.PORT) || 4000,
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

  // FX rates for the "convert to USD" import (frankfurter.dev).
  frankfurterBase: process.env.FRANKFURTER_BASE || 'https://api.frankfurter.dev/v1',

  // Google sign-in + session auth.
  auth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
    // Only accounts on this domain may sign in.
    allowedDomain: process.env.ALLOWED_EMAIL_DOMAIN || 'gatpsolutions.com',
    sessionTtl: process.env.SESSION_TTL || '7d',
  },

  // Backblaze B2 (S3-compatible) object storage — where workbooks are kept.
  b2: {
    endpoint: process.env.B2_ENDPOINT || '', // e.g. https://s3.us-east-005.backblazeb2.com
    // Region must match the endpoint's; derive it from the endpoint if unset.
    region:
      process.env.B2_REGION ||
      (process.env.B2_ENDPOINT || '').match(/s3\.([^.]+)\.backblazeb2\.com/)?.[1] ||
      'us-east-005',
    bucket: process.env.B2_BUCKET || '',
    keyId: process.env.B2_KEY_ID || '',
    appKey: process.env.B2_APP_KEY || '',
    // How long presigned download links stay valid.
    urlExpirySeconds: Number(process.env.B2_URL_EXPIRY) || 600,
  },
};

export default config;
