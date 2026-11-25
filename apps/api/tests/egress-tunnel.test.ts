import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EgressPoolManager } from '../src/services/egress-pool.service.js';
import { signTunnelPayload, verifyTunnelToken } from '../src/routes/tunnel.js';
import { buildServer } from '../src/server.js';

test('EgressPoolManager & Cobalt-style Stateless Tunnel', async (t) => {
  await t.test('1. Selects ISP before residential/direct and honors pinned ip= affinity', () => {
    const pool = new EgressPoolManager([
      { id: 'res-1', proxyType: 'residential', proxyUrl: 'http://res.example.com:8000', cookiesPath: '/tmp/c2.txt' },
      { id: 'isp-1', proxyType: 'isp', proxyUrl: 'http://isp1.example.com:8000', cookiesPath: '/tmp/c1.txt' },
      { id: 'direct', proxyType: 'direct' },
    ]);

    const first = pool.selectProfile();
    assert.equal(first.id, 'isp-1');
    pool.markSuccess(first.id);

    const pinned = pool.selectProfile({ preferredId: 'res-1' });
    assert.equal(pinned.id, 'res-1');
    pool.releaseProfile(pinned.id);
  });

  await t.test('2. Quarantines blocked egress profile and fails over cleanly', () => {
    const pool = new EgressPoolManager([
      { id: 'isp-a', proxyType: 'isp', proxyUrl: 'http://user:pass@isp-a.example.com:8000' },
      { id: 'isp-b', proxyType: 'isp', proxyUrl: 'http://user:pass@isp-b.example.com:8000' },
    ]);

    const first = pool.selectProfile();
    assert.equal(first.id, 'isp-a');
    pool.markRateLimitedOrBlocked('isp-a', 'Sign in to confirm you are not a bot');

    const second = pool.selectProfile();
    assert.equal(second.id, 'isp-b');

    const snapshot = pool.getPoolSnapshot();
    assert.equal(snapshot.totalProfiles, 2);
    assert.equal(snapshot.quarantinedProfiles, 1);
    assert.equal(snapshot.healthyProfiles, 1);
    // Must redact proxy credentials
    assert.equal(JSON.stringify(snapshot).includes('user:pass'), false);
    assert.equal(snapshot.profiles.find((p) => p.id === 'isp-a')?.proxyHost, 'isp-a.example.com');
  });

  await t.test('3. Binds cookies 1:1 to proxies in YTDLP_PROXY_POOL + YTDLP_COOKIE_POOL_DIR', () => {
    const cookieDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muxaro-cookie-pool-'));
    fs.writeFileSync(path.join(cookieDir, '01-acct.txt'), '# Netscape HTTP Cookie File\n.youtube.com\n', 'utf8');
    fs.writeFileSync(path.join(cookieDir, '02-acct.txt'), '# Netscape HTTP Cookie File\n.youtube.com\n', 'utf8');

    const prevPool = process.env.YTDLP_PROXY_POOL;
    const prevDir = process.env.YTDLP_COOKIE_POOL_DIR;
    process.env.YTDLP_PROXY_POOL = 'http://p1.isp.local:8080,http://p2.isp.local:8080';
    process.env.YTDLP_COOKIE_POOL_DIR = cookieDir;

    try {
      const manager = new EgressPoolManager();
      const p1 = manager.getProfileById('pool-1');
      const p2 = manager.getProfileById('pool-2');
      assert.ok(p1?.cookiesPath?.endsWith('01-acct.txt'));
      assert.ok(p2?.cookiesPath?.endsWith('02-acct.txt'));
      assert.notEqual(p1?.cookiesPath, p2?.cookiesPath);
    } finally {
      if (prevPool === undefined) delete process.env.YTDLP_PROXY_POOL;
      else process.env.YTDLP_PROXY_POOL = prevPool;
      if (prevDir === undefined) delete process.env.YTDLP_COOKIE_POOL_DIR;
      else process.env.YTDLP_COOKIE_POOL_DIR = prevDir;
      fs.rmSync(cookieDir, { recursive: true, force: true });
    }
  });

  await t.test('4. HMAC tunnel token signing, tamper detection, and SSRF defense', async () => {
    const token = signTunnelPayload({
      mode: 'stream',
      url: 'https://cdn.example.com/video.mp4',
      filename: 'video.mp4',
      ext: 'mp4',
      egressProfileId: 'isp-1',
    });

    const verified = verifyTunnelToken(token);
    assert.ok(verified);
    assert.equal(verified?.egressProfileId, 'isp-1');
    assert.equal(verified?.url, 'https://cdn.example.com/video.mp4');

    // Tampered token must fail verification
    const tampered = `${token.slice(0, -4)}AAAA`;
    assert.equal(verifyTunnelToken(tampered), null);

    // Server route rejects SSRF sign attempts and invalid tunnel tokens
    const app = await buildServer({ logLevel: 'silent' });
    try {
      const ssrfRes = await app.inject({
        method: 'POST',
        url: '/api/v1/tunnel/sign',
        payload: { url: 'http://169.254.169.254/latest/meta-data' },
      });
      assert.equal(ssrfRes.statusCode, 403);

      const signRes = await app.inject({
        method: 'POST',
        url: '/api/v1/tunnel/sign',
        payload: { url: 'https://example.com/sample.mp4', filename: 'sample', ext: 'mp4' },
      });
      assert.equal(signRes.statusCode, 200);
      const signBody = signRes.json();
      assert.ok(String(signBody.data.tunnelPath).startsWith('/api/v1/tunnel?token='));

      const badTunnelRes = await app.inject({
        method: 'GET',
        url: '/api/v1/tunnel?token=invalid.sig',
      });
      assert.equal(badTunnelRes.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});
