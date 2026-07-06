const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config');

// Backblaze B2 via its S3-compatible API. All run artifacts (per-seller exports,
// combined summaries, and the final import workbook) live here instead of on the
// local (ephemeral) filesystem, so they survive across serverless invocations.

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let client;
function getClient() {
  if (!config.b2.endpoint || !config.b2.bucket) {
    throw new Error(
      'Backblaze B2 is not configured — set B2_ENDPOINT, B2_BUCKET, B2_KEY_ID and B2_APP_KEY'
    );
  }
  if (!client) {
    client = new S3Client({
      endpoint: config.b2.endpoint,
      region: config.b2.region,
      credentials: {
        accessKeyId: config.b2.keyId,
        secretAccessKey: config.b2.appKey,
      },
    });
  }
  return client;
}

// Upload a buffer and return its key.
async function putObject(key, body, contentType = XLSX_CONTENT_TYPE) {
  await getClient().send(
    new PutObjectCommand({
      Bucket: config.b2.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

// Download an object into memory.
async function getObjectBuffer(key) {
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: config.b2.bucket, Key: key })
  );
  return Buffer.from(await res.Body.transformToByteArray());
}

// A short-lived presigned URL that downloads the object as `filename`.
async function getDownloadUrl(key, filename) {
  const cmd = new GetObjectCommand({
    Bucket: config.b2.bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
    ResponseContentType: XLSX_CONTENT_TYPE,
  });
  return getSignedUrl(getClient(), cmd, {
    expiresIn: config.b2.urlExpirySeconds,
  });
}

module.exports = { putObject, getObjectBuffer, getDownloadUrl, XLSX_CONTENT_TYPE };
