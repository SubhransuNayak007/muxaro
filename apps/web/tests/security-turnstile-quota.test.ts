import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSsrfUrl,
  isIpBlocked,
  isIpv4Blocked,
  isIpv6Blocked,
  ipv4ToInt,
  isPrivateOrBlockedHost,
  assertSafeUrl,
} from '../lib/security/ssrf.ts';
import {
  createSessionJwt,
  verifySessionJwt,
  issueTurnstileSessionToken,
  verifyTurnstileSessionToken,
  verifyTurnstileToken,
} from '../lib/security/turnstile.ts';
import {
  normalizeUnifiedQuota,
  DEFAULT_UNIFIED_QUOTA,
  quotaManager,
} from '../lib/quota/quota-manager.ts';
import fs from 'node:fs';
import path from 'node:path';

describe('Task 1: SSRF Protection & URL Validator', () => {
  it('strictly blocks IPv4 loopback (127.0.0.0/8)', () => {
    const loopbacks = ['127.0.0.1', '127.0.0.2', '127.1.2.3', '127.255.255.254'];
    for (const ip of loopbacks) {
      assert.strictEqual(isIpBlocked(ip).blocked, true, `Should block loopback ${ip}`);
    }
  });

  it('strictly blocks IPv6 loopback (::1) and unspecified (::)', () => {
    assert.strictEqual(isIpBlocked('::1').blocked, true);
    assert.strictEqual(isIpBlocked('0:0:0:0:0:0:0:1').blocked, true);
    assert.strictEqual(isIpBlocked('::').blocked, true);
  });

  it('strictly blocks RFC1918 private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)', () => {
    const rfc1918 = [
      '10.0.0.1',
      '10.255.255.254',
      '172.16.0.1',
      '172.24.1.1',
      '172.31.255.254',
      '192.168.0.1',
      '192.168.1.100',
      '192.168.255.254',
    ];
    for (const ip of rfc1918) {
      assert.strictEqual(isIpBlocked(ip).blocked, true, `Should block RFC1918 IP ${ip}`);
    }
  });

  it('strictly blocks link-local & cloud metadata (169.254.169.254, 169.254.0.0/16, fe80::/10)', () => {
    const metadata = ['169.254.169.254', '169.254.1.1', '169.254.254.254', 'fe80::1', 'fe80::169:254'];
    for (const ip of metadata) {
      assert.strictEqual(isIpBlocked(ip).blocked, true, `Should block metadata/link-local IP ${ip}`);
    }
  });

  it('strictly blocks non-routable, multicast, and reserved addresses', () => {
    const nonRoutable = [
      '0.0.0.0',
      '100.64.0.1', // CGNAT
      '192.0.2.1', // TEST-NET-1
      '198.51.100.1', // TEST-NET-2
      '203.0.113.1', // TEST-NET-3
      '224.0.0.1', // Multicast
      '239.255.255.250',
      '240.0.0.1', // Reserved
      '255.255.255.255', // Broadcast
      'fc00::1', // ULA
      'fd12::34',
      'ff02::1', // Multicast
      '2001:db8::1', // Documentation
    ];
    for (const ip of nonRoutable) {
      assert.strictEqual(isIpBlocked(ip).blocked, true, `Should block non-routable ${ip}`);
    }
  });

  it('blocks IPv4-mapped IPv6 addresses for private ranges', () => {
    assert.strictEqual(isIpBlocked('::ffff:127.0.0.1').blocked, true);
    assert.strictEqual(isIpBlocked('::ffff:10.0.0.1').blocked, true);
    assert.strictEqual(isIpBlocked('::ffff:169.254.169.254').blocked, true);
  });

  it('blocks dangerous hostnames and domain suffixes', () => {
    assert.strictEqual(isPrivateOrBlockedHost('localhost'), true);
    assert.strictEqual(isPrivateOrBlockedHost('test.localhost'), true);
    assert.strictEqual(isPrivateOrBlockedHost('metadata.google.internal'), true);
    assert.strictEqual(isPrivateOrBlockedHost('service.internal'), true);
    assert.strictEqual(isPrivateOrBlockedHost('router.local'), true);
  });

  it('rejects forbidden URL schemes (file:, gopher:, ftp:, javascript:)', async () => {
    const badSchemes = [
      'file:///etc/passwd',
      'gopher://127.0.0.1:70/',
      'ftp://example.com/file',
      'javascript:alert(1)',
    ];
    for (const url of badSchemes) {
      const res = await validateSsrfUrl(url);
      assert.strictEqual(res.valid, false, `Should reject ${url}`);
    }
  });

  it('rejects URLs targeting private IPs directly', async () => {
    const privateUrls = [
      'http://127.0.0.1:8080/admin',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/api',
      'https://[::1]/debug',
    ];
    for (const url of privateUrls) {
      const res = await validateSsrfUrl(url);
      assert.strictEqual(res.valid, false, `Should reject private URL ${url}`);
    }
  });
});

describe('Task 2: Cloudflare Turnstile & 5-Minute Session JWT Helper', () => {
  it('issues and verifies a valid 5-minute session JWT', () => {
    const token = issueTurnstileSessionToken({
      ip: '198.51.100.42',
      sub: 'usr_verified_99',
    });
    assert.strictEqual(typeof token, 'string');
    assert.strictEqual(token.split('.').length, 3);

    const verified = verifyTurnstileSessionToken(token, '198.51.100.42');
    assert.strictEqual(verified.valid, true);
    assert.strictEqual(verified.payload?.sub, 'usr_verified_99');
    assert.strictEqual(verified.payload?.verified, true);

    // Verify exactly 5-minute lifespan
    const now = Math.floor(Date.now() / 1000);
    const exp = verified.payload!.exp;
    const diff = exp - now;
    assert.ok(diff >= 295 && diff <= 300, `Expected ~300s expiry, got ${diff}s`);
  });

  it('rejects token on IP mismatch when IP binding is checked', () => {
    const token = issueTurnstileSessionToken({
      ip: '198.51.100.42',
      sub: 'usr_verified_99',
    });
    const verified = verifyTurnstileSessionToken(token, '203.0.113.1');
    assert.strictEqual(verified.valid, false);
    assert.ok(verified.error?.includes('mismatch'));
  });

  it('rejects an expired token', () => {
    const expiredToken = createSessionJwt({
      sub: 'usr_old',
      verified: true,
      iat: Math.floor(Date.now() / 1000) - 400,
      exp: Math.floor(Date.now() / 1000) - 100, // expired 100s ago
    });
    const verified = verifySessionJwt(expiredToken);
    assert.strictEqual(verified, null);
  });

  it('rejects tampered token or incorrect secret signature', () => {
    const token = createSessionJwt({ sub: 'usr_original' }, 'secret-key-1');
    const verified = verifySessionJwt(token, 'different-secret-key-2');
    assert.strictEqual(verified, null);
  });

  it('verifies Cloudflare test tokens in test environment', async () => {
    const testRes = await verifyTurnstileToken('XXXX.DUMMY.TOKEN.XXXX');
    assert.strictEqual(testRes.success, true);
    assert.strictEqual(testRes.hostname, 'localhost');
  });
});

describe('Task 3: Unified Quota Manager', () => {
  it('normalizes quota data with defaults', () => {
    const q = normalizeUnifiedQuota({});
    assert.strictEqual(q.dailyVideoLimit, 10);
    assert.strictEqual(q.remainingVideoCredits, 10);
    assert.strictEqual(q.playlistJobsLimit, 1);
    assert.strictEqual(q.remainingPlaylistCredits, 1);
    assert.strictEqual(q.rollingWindowHours, 24);
  });

  it('normalizes custom API quota payload correctly', () => {
    const custom = normalizeUnifiedQuota({
      data: {
        tier: 'registered',
        baseLimit: 15,
        baseUsed: 3,
        baseRemaining: 12,
        playlistJobsLimit: 2,
        playlistJobsUsed: 1,
        playlistJobsRemaining: 1,
        maxPlaylistItems: 50,
      },
    });
    assert.strictEqual(custom.dailyVideoLimit, 15);
    assert.strictEqual(custom.usedVideoJobs, 3);
    assert.strictEqual(custom.remainingVideoCredits, 12);
    assert.strictEqual(custom.playlistJobsLimit, 2);
    assert.strictEqual(custom.remainingPlaylistCredits, 1);
  });

  it('records optimistic deduction accurately', () => {
    // Prime the quota
    (quotaManager as any).cachedQuota = { ...DEFAULT_UNIFIED_QUOTA };
    quotaManager.recordOptimisticDeduction('video', 2);
    const cached = (quotaManager as any).cachedQuota;
    assert.strictEqual(cached.usedVideoJobs, 2);
    assert.strictEqual(cached.remainingVideoCredits, 8);
  });
});

describe('Task 4: Zero Ads Verification', () => {
  it('verifies apps/web/app/credits/page.tsx has completely removed RewardedAdCard and ad claims', () => {
    const creditsPagePath = path.resolve(process.cwd(), 'apps/web/app/credits/page.tsx');
    const content = fs.readFileSync(creditsPagePath, 'utf8');

    assert.strictEqual(content.includes('RewardedAdCard'), false, 'RewardedAdCard must not be in credits page');
    assert.strictEqual(content.includes('Extra credits from ads'), false, 'Extra credits from ads must be removed');
    assert.strictEqual(content.includes('Bonus ad credits'), false, 'Bonus ad credits must be removed');
    assert.strictEqual(content.includes('rewarded ads'), false, 'Rewarded ads text must be removed');
  });
});

describe('Task 5: Google OAuth Conditional Rendering', () => {
  it('verifies /login and /register do not show unavailable message when unconfigured', () => {
    const loginPage = fs.readFileSync(path.resolve(process.cwd(), 'apps/web/app/login/page.tsx'), 'utf8');
    const registerPage = fs.readFileSync(path.resolve(process.cwd(), 'apps/web/app/register/page.tsx'), 'utf8');

    assert.strictEqual(
      loginPage.includes('Google sign-in is currently unavailable on this server'),
      false,
      'Login page must not display unavailable banner'
    );
    assert.strictEqual(
      registerPage.includes('Google sign-up is currently unavailable on this server'),
      false,
      'Register page must not display unavailable banner'
    );
  });
});
