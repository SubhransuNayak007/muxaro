/**
 * MUXARO Homepage Live & Asset Verifier
 * Verifies that http://localhost:3000 loads with 200 OK and 0 404 chunks.
 */

async function main() {
  const url = process.env.WEB_BASE || 'http://localhost:3000';
  console.log(`Connecting to ${url}...`);

  const res = await fetch(url);
  if (res.status !== 200) {
    throw new Error(`Expected HTTP 200 from ${url}, received HTTP ${res.status}`);
  }
  console.log(`PASS: ${url} returned HTTP 200 OK`);

  const html = await res.text();
  const chunkRegex = /\/_next\/static\/[^"'<>\s\\]+/g;
  const matches = [...html.matchAll(chunkRegex)].map(m => m[0]);
  const uniqueChunks = [...new Set(matches)];

  console.log(`Found ${uniqueChunks.length} unique client chunks referenced by homepage.`);
  let failedChunks = 0;

  for (const chunk of uniqueChunks) {
    const chunkUrl = `${url}${chunk}`;
    const chunkRes = await fetch(chunkUrl);
    if (chunkRes.status !== 200) {
      console.error(`FAIL: [${chunkRes.status}] ${chunk}`);
      failedChunks++;
    } else {
      console.log(`PASS: [200] ${chunk}`);
    }
  }

  if (failedChunks > 0) {
    throw new Error(`Asset verification failed: ${failedChunks} chunks returned non-200`);
  }

  console.log('\n✔ Verification SUCCESS: http://localhost:3000 loads with 200 OK and 0 404 chunks.\n');
}

main().catch(err => {
  console.error('VERIFICATION ERROR:', err.message);
  process.exit(1);
});
