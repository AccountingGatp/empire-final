const headers = {
  'X-API-KEY': 'B8z3DwdRk-iPtcW0g5E5OA8_37nfYjiWJDwtQ8F5OAQ',
};

// Fetch the list of delegators (sellers) from the Xola API.
async function fetchDelegators(limit = 500) {
  const url = `https://xola.com/api/delegators?limit=${limit}`;
  const res = await fetch(url, { method: 'GET', headers });

  if (!res.ok) {
    throw new Error(`fetchDelegators failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

module.exports = { fetchDelegators };
