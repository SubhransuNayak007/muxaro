/**
 * Test Suite: Direct 302 CDN Tunneling Pipeline
 */

import assert from 'node:assert/strict';
import {
  isAllowedCdnUrl,
  DirectTunnelTokenService,
  buildDirectCdnRedirect,
  sanitizeDownloadFilename,
} from '../src/direct-302-tunnel.ts';

console.log('--- Running Direct 302 CDN Tunneling Tests ---');

// Test 1: Allowed CDN Domain Filtering
{
  assert(isAllowedCdnUrl('https://v16-webapp-prime.tiktokcdn.com/video/tos/useast2a/tos-useast2a-ve-0068c001-euttp/1234.mp4'), 'TikTok CDN must be allowed');
  assert(isAllowedCdnUrl('https://scontent.cdninstagram.com/v/t50.2886-16/12345.mp4?_nc_cat=100'), 'Instagram CDN must be allowed');
  assert(isAllowedCdnUrl('https://video.twimg.com/ext_tw_video/123456789/pu/vid/720x1280/abc.mp4'), 'Twitter video CDN must be allowed');
  assert(isAllowedCdnUrl('https://rr3---sn-4g5ednks.googlevideo.com/videoplayback?expire=12345'), 'Google Video CDN must be allowed');

  // Forbidden URLs
  assert(!isAllowedCdnUrl('http://v16-webapp-prime.tiktokcdn.com/insecure'), 'HTTP (non-SSL) must be rejected');
  assert(!isAllowedCdnUrl('https://evil-attacker.com/payload.mp4'), 'Non-whitelisted domain must be rejected');
  assert(!isAllowedCdnUrl('https://user:pass@scontent.cdninstagram.com/video.mp4'), 'Embedded credentials must be rejected');
  assert(!isAllowedCdnUrl('https://169.254.169.254/latest/meta-data'), 'Cloud metadata IP must be rejected');
  assert(!isAllowedCdnUrl('https://localhost:8080/exploit'), 'Localhost must be rejected');
  console.log('✓ Allowed CDN domain filtering and anti-SSRF checks passed');
}

// Test 2: Token Generation and Verification
{
  const tokenService = new DirectTunnelTokenService({
    secretKey: 'ultra-secret-test-key-32-chars-long!',
    tokenTtlSeconds: 60,
  });

  const validTarget = 'https://v16-webapp-prime.tiktokcdn.com/video/mp4/test.mp4';
  const token = tokenService.createSignedToken({
    targetUrl: validTarget,
    provider: 'tiktok',
    filename: 'Dance Challenge #Trending.mp4',
  });

  assert(token.includes('.'), 'Token must contain payload.signature dot format');

  const payload = tokenService.verifyToken(token);
  assert.equal(payload.targetUrl, validTarget);
  assert.equal(payload.provider, 'tiktok');
  assert.equal(payload.filename, 'Dance Challenge #Trending.mp4');
  console.log('✓ Token generation and cryptographic verification passed');
}

// Test 3: Tampered Token Rejection
{
  const tokenService = new DirectTunnelTokenService({
    secretKey: 'ultra-secret-test-key-32-chars-long!',
    tokenTtlSeconds: 60,
  });

  const token = tokenService.createSignedToken({
    targetUrl: 'https://video.twimg.com/ext_tw_video/123/vid/test.mp4',
    provider: 'twitter',
    filename: 'clip.mp4',
  });

  const parts = token.split('.');
  const tamperedToken = `${parts[0]}X.${parts[1]}`;

  assert.throws(() => {
    tokenService.verifyToken(tamperedToken);
  }, /verification failed|malformed/i, 'Tampered token must be rejected');
  console.log('✓ Tampered token rejection passed');
}

// Test 4: Expired Token Rejection
{
  const tokenService = new DirectTunnelTokenService({
    secretKey: 'ultra-secret-test-key-32-chars-long!',
    tokenTtlSeconds: -10, // already expired
  });

  const expiredToken = tokenService.createSignedToken({
    targetUrl: 'https://video.twimg.com/test.mp4',
    provider: 'twitter',
    filename: 'clip.mp4',
  });

  assert.throws(() => {
    tokenService.verifyToken(expiredToken);
  }, /expired/i, 'Expired token must throw');
  console.log('✓ Expired token rejection passed');
}

// Test 5: Client IP Locking
{
  const tokenService = new DirectTunnelTokenService({
    secretKey: 'ultra-secret-test-key-32-chars-long!',
  });

  const lockedToken = tokenService.createSignedToken({
    targetUrl: 'https://rr1---sn-4g5ednks.googlevideo.com/videoplayback?id=123',
    provider: 'youtube_progressive',
    filename: 'video_720p.mp4',
    clientIp: '198.51.100.42',
  });

  // Verify from matching IP -> OK
  const verified = tokenService.verifyToken(lockedToken, '198.51.100.42');
  assert.equal(verified.provider, 'youtube_progressive');

  // Verify from different IP -> Throws
  assert.throws(() => {
    tokenService.verifyToken(lockedToken, '203.0.113.99');
  }, /locked to client IP/i, 'Mismatched caller IP must be rejected');
  console.log('✓ Client IP locking verification passed');
}

// Test 6: Zero-Bandwidth Direct Redirect Response Builder
{
  const payload = {
    targetUrl: 'https://scontent.cdninstagram.com/reels/video.mp4',
    provider: 'instagram' as const,
    filename: 'My Reel: Cool & Fun.mp4',
    exp: Math.floor(Date.now() / 1000) + 60,
  };

  const redirect = buildDirectCdnRedirect(payload, { statusCode: 302 });
  assert.equal(redirect.statusCode, 302);
  assert.equal(redirect.redirectUrl, payload.targetUrl);
  assert.equal(redirect.headers['Location'], payload.targetUrl);
  assert.equal(redirect.headers['Referrer-Policy'], 'no-referrer', 'Must strip referrer to prevent hotlink blocks');
  assert(redirect.headers['Content-Disposition'].includes('attachment;'), 'Must specify attachment download');
  assert.equal(redirect.headers['X-Garuda-Egress'], 'direct-302-tunnel');
  console.log('✓ Zero-bandwidth direct redirect response builder passed');
}

console.log('All Direct 302 CDN Tunneling tests passed successfully!\n');
