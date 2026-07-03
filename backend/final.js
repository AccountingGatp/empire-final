// const url =
//   'https://xola.com/api/transactions?type[in]=purchase,refund,refund_commission,deposit,balance,purchase_affiliate,redeem,plugin_fee&format=xlsx&createdAt[range]=2026-06-02T00:00:00%2B02:00,2026-07-02T23:59:59%2B02:00&seller=67a528448b4254efbf0085c1';

// const headers = {
//   'X-API-KEY': 'B8z3DwdRk-iPtcW0g5E5OA8_37nfYjiWJDwtQ8F5OAQ',
// };

// async function main() {
//   const res = await fetch(url, { method: 'GET', headers });
//   console.log('Status:', res.status, res.statusText);
//   console.log('Content-Type:', res.headers.get('content-type'));

//   if (!res.ok) {
//     console.error(await res.text());
//     process.exit(1);
//   }

//   console.log(await res.json());
// }

// main().catch((err) => {
//   console.error('Request failed:', err);
//   process.exit(1);
// });





























const fs = require('fs');
const path = require('path');

const SELLER = '67a528448b4254efbf0085c1';

const url =
  'https://xola.com/api/transactions?type[in]=purchase,refund,refund_commission,deposit,balance,purchase_affiliate,redeem,plugin_fee&format=xlsx&createdAt[range]=2026-06-02T00:00:00%2B02:00,2026-07-02T23:59:59%2B02:00&seller=' +
  SELLER;

const headers = {
  'X-API-KEY': 'B8z3DwdRk-iPtcW0g5E5OA8_37nfYjiWJDwtQ8F5OAQ',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Poll the async export job until it finishes, then return the completed job.
async function waitForJob(jobId, { interval = 2000, maxAttempts = 30 } = {}) {
  const jobUrl = `https://xola.com/api/jobs/${jobId}?seller=${SELLER}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(jobUrl, { method: 'GET', headers });
    if (!res.ok) {
      throw new Error(`Job poll failed: ${res.status} ${res.statusText}`);
    }

    const job = await res.json();
    console.log(
      `Attempt ${attempt}: status=${job.status} processedCount=${job.processedCount}`
    );

    if (['complete', 'completed', 'done'].includes(job.status)) {
      return job;
    }
    if (['failed', 'error'].includes(job.status)) {
      throw new Error(`Job ${jobId} failed with status "${job.status}"`);
    }

    await sleep(interval);
  }

  throw new Error(`Job ${jobId} did not complete after ${maxAttempts} attempts`);
}

async function downloadExcel(fileUrl, outDir = 'downloads') {
  const res = await fetch(fileUrl, {
    method: 'GET',
    headers: {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
    },
  });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const fileName = decodeURIComponent(new URL(fileUrl).pathname.split('/').pop());
  const outPath = path.join(outDir, fileName);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buffer);

  console.log(`Saved ${buffer.length} bytes to ${outPath}`);
  return outPath;
}

async function main() {
  const res = await fetch(url, { method: 'GET', headers });
  console.log('Status:', res.status, res.statusText);

  if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
  }

  const data = await res.json();
  console.log('Export job created:', data.id, data.status);

  // The export is generated asynchronously; wait for the job to finish.
  const job = await waitForJob(data.id);

  const fileUrl = job.url || data.url;
  if (fileUrl) {
    await downloadExcel(fileUrl);
  } else {
    console.warn('No "url" field found in the completed job.');
  }
}

main().catch((err) => {
  console.error('Request failed:', err);
  process.exit(1);
});
