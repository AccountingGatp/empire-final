const fs = require('fs');
const path = require('path');

const { fetchDelegators} = require("./utils")

const SELLER = '67a50776dab2ee69c31004f6';
const TZ = '';

const headers = {
  'X-API-KEY': 'B8z3DwdRk-iPtcW0g5E5OA8_37nfYjiWJDwtQ8F5OAQ',
};

// Build the payout report export URL for a given date range.
// `from` / `to` are plain dates like '2026-06-25' and '2026-07-02'.
function buildTransactionsUrl(from, to, seller) {
  const range = `${from}T00:00:00${TZ},${to}T23:59:59${TZ}`;

  const params = new URLSearchParams({
    format: 'xlsx',
    'createdAt[range]': range,
    context: 'payout_report',
    seller,
  });

  return `https://xola.com/api/transactions?${params.toString()}`;
}

// Create the export job for a date range and return the parsed response.
async function fetchTransactions(from, to, seller) {
  const url = buildTransactionsUrl(from, to, seller);
  const res = await fetch(url, { method: 'GET', headers });
  console.log('Status:', res.status, res.statusText);

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

async function downloadExcel(fileUrl, fileName, outDir = 'downloads_payout') {
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  // Use the provided name, otherwise fall back to the S3 filename.
  const name =
    fileName || decodeURIComponent(new URL(fileUrl).pathname.split('/').pop());
  const outPath = path.join(outDir, name);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buffer);

  console.log(`Saved ${buffer.length} bytes to ${outPath}`);
  return outPath;
}

async function main() {
  const from = '2026-05-01';
  const to = '2026-05-31';
  const seller = SELLER;

  const list_seller = await fetchDelegators()
// console.log(list_seller.data)

for (const element of list_seller.data) {
  try {
    const data = await fetchTransactions(from, to, element.id);

    console.log(data);

    if (data.url) {
    //   const fileName =
    //     `${element.name}_${element.city}_${element.state}_${element.country}_${from}_${to}`.replace(
    //       / /g,
    //       '_'
    //     ) + '.xlsx';

          const fileName =
        `${element.name}`.replace(
          / /g,
          '_'
        ) + '.xlsx';


      await new Promise((resolve) => setTimeout(resolve, 30000));
      await downloadExcel(data.url, fileName);
    } else {
      console.warn('No "url" field found in the response.');
    }
  } catch (err) {
    console.error(`Skipping seller ${element.id} (${element.name}):`, err.message);
    continue;
  }
}
}

main().catch((err) => {
  console.error('Request failed:', err);
  process.exit(1);
});
