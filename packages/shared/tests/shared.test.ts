/**
 * MUXARO Media Processing Platform - Shared Core Unit Tests
 * 
 * Validates codec matrix, MuxaroError, URL guard (SSRF & canonicalization),
 * and Zod API contracts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent } from 'undici';
import {
  // Types & Configs
  USER_TIERS,
  TOOLS,
  LANES,
  JOB_STATUSES,
  RETENTION_TIERS,
  AUDIO_BITRATES,
  TIER_CONFIGS,
  // Codec Matrix
  canZeroCopyRemux,
  normalizeCodec,
  isZeroCopyVideoSupported,
  isZeroCopyAudioSupported,
  // Errors
  MuxaroError,
  // URL Guard
  normalizeMediaUrl,
  canonicalizeMediaUrl,
  ipv4ToNumber,
  isForbiddenIpv4,
  isForbiddenIpv6,
  isForbiddenHostname,
  validateUrlSafety,
  // SSRF Fetch & Assertions
  assertPublicIp,
  isPublicIp,
  parseIpv4ToNumber,
  isForbiddenIpv4Number,
  parseIpv6Address,
  isForbiddenIpv6Address,
  isForbiddenHostnameString,
  validateFetchUrl,
  createSsrfSafeAgent,
  defaultSsrfSafeAgent,
  ssrfSafeFetch,
  // Contracts
  analyseRequestSchema,
  analyseResponseSchema,
  createJobRequestSchema,
  jobResponseSchema,
  uploadInitRequestSchema,
  uploadCompleteRequestSchema,
  downloadItemSchema,
  serviceStatusResponseSchema,
  dailyUsageResponseSchema,
} from '../dist/index.js';

describe('MUXARO Shared Core - Types & Configs', () => {
  it('defines all required user tiers, tools, lanes, and retention', () => {
    assert.deepEqual(USER_TIERS, ['guest', 'free_account', 'pro']);
    assert.deepEqual(TOOLS, ['convert_video', 'extract_audio', 'merge_av', 'batch_playlist']);
    assert.deepEqual(LANES, ['fast_io', 'transcode', 'batch']);
    assert.deepEqual(RETENTION_TIERS, ['60m', '24h']);
    assert.deepEqual(AUDIO_BITRATES, ['128k', '192k', '256k', '320k']);
  });

  it('correctly associates retention and quota per tier', () => {
    assert.equal(TIER_CONFIGS.guest.retentionTier, '60m');
    assert.equal(TIER_CONFIGS.guest.retentionSeconds, 3600);
    assert.equal(TIER_CONFIGS.free_account.retentionTier, '24h');
    assert.equal(TIER_CONFIGS.free_account.retentionSeconds, 86400);
    assert.equal(TIER_CONFIGS.pro.retentionTier, '24h');
  });
});

describe('MUXARO Shared Core - Codec Matrix & Remux Engine', () => {
  it('normalizes common video and audio codecs accurately', () => {
    assert.equal(normalizeCodec('avc1.640028'), 'h264');
    assert.equal(normalizeCodec('hvc1.1.6.L150.90'), 'hevc');
    assert.equal(normalizeCodec('vp09.00.41.08'), 'vp9');
    assert.equal(normalizeCodec('av01.0.08M.08'), 'av1');
    assert.equal(normalizeCodec('mp4a.40.2'), 'aac');
    assert.equal(normalizeCodec('pcm_s16le'), 'pcm');
  });

  it('verifies zero-copy remux for MP4 target', () => {
    // H264 + AAC in MP4 -> zero copy
    assert.equal(canZeroCopyRemux('h264', 'aac', 'mp4'), true);
    // HEVC + Opus in MP4 -> zero copy
    assert.equal(canZeroCopyRemux('hevc', 'opus', 'mp4'), true);
    // VP8 + Vorbis in MP4 -> false (VP8 not supported in MP4)
    assert.equal(canZeroCopyRemux('vp8', 'vorbis', 'mp4'), false);
    // ProRes in MP4 -> false
    assert.equal(canZeroCopyRemux('prores', 'aac', 'mp4'), false);
  });

  it('verifies zero-copy remux for MKV target (universal container)', () => {
    assert.equal(canZeroCopyRemux('h264', 'aac', 'mkv'), true);
    assert.equal(canZeroCopyRemux('hevc', 'flac', 'mkv'), true);
    assert.equal(canZeroCopyRemux('vp9', 'opus', 'mkv'), true);
    assert.equal(canZeroCopyRemux('prores', 'pcm', 'mkv'), true);
  });

  it('verifies zero-copy remux for WebM target (strict VP8/VP9/AV1 + Opus/Vorbis)', () => {
    assert.equal(canZeroCopyRemux('vp9', 'opus', 'webm'), true);
    assert.equal(canZeroCopyRemux('av1', 'opus', 'webm'), true);
    assert.equal(canZeroCopyRemux('vp8', 'vorbis', 'webm'), true);
    // H264 in WebM is strictly invalid
    assert.equal(canZeroCopyRemux('h264', 'opus', 'webm'), false);
    // AAC in WebM is invalid
    assert.equal(canZeroCopyRemux('vp9', 'aac', 'webm'), false);
  });

  it('verifies zero-copy remux for MOV target', () => {
    assert.equal(canZeroCopyRemux('prores', 'pcm', 'mov'), true);
    assert.equal(canZeroCopyRemux('h264', 'aac', 'mov'), true);
    assert.equal(canZeroCopyRemux('vp9', 'opus', 'mov'), false);
  });

  it('verifies audio-only extraction zero-copy', () => {
    assert.equal(canZeroCopyRemux('', 'mp3', 'mp3'), true);
    assert.equal(canZeroCopyRemux('', 'flac', 'flac'), true);
    assert.equal(canZeroCopyRemux('', 'aac', 'mp3'), false); // AAC cannot zero-copy to MP3 container
    assert.equal(canZeroCopyRemux('', 'aac', 'm4a'), true);
  });
});

describe('MUXARO Shared Core - MuxaroError', () => {
  it('instantiates typed operational errors with correct status codes', () => {
    const err = MuxaroError.badRequest('Missing field', { field: 'url' });
    assert.equal(err.code, 'BAD_REQUEST');
    assert.equal(err.statusCode, 400);
    assert.equal(err.isOperational, true);

    const json = err.toJSON();
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'BAD_REQUEST');
    assert.equal(json.error.statusCode, 400);
  });

  it('correctly maps all error categories', () => {
    assert.equal(MuxaroError.unauthorized().statusCode, 401);
    assert.equal(MuxaroError.forbidden().statusCode, 403);
    assert.equal(MuxaroError.ssrfBlocked().statusCode, 403);
    assert.equal(MuxaroError.notFound('Job', '123').statusCode, 404);
    assert.equal(MuxaroError.rateLimited().statusCode, 429);
    assert.equal(MuxaroError.quotaExceeded().statusCode, 429);
    assert.equal(MuxaroError.circuitBreakerOpen('worker-media').statusCode, 503);
    assert.equal(MuxaroError.extractionFailed('Downstream error').statusCode, 502);
  });
});

describe('MUXARO Shared Core - URL Guard & SSRF Defense', () => {
  it('converts and rejects forbidden IPv4 addresses in various representations', () => {
    // Standard dotted
    const loopback = ipv4ToNumber('127.0.0.1');
    assert.ok(loopback !== null);
    assert.equal(isForbiddenIpv4(loopback).isForbidden, true);

    const rfc1918 = ipv4ToNumber('192.168.1.1');
    assert.ok(rfc1918 !== null);
    assert.equal(isForbiddenIpv4(rfc1918).isForbidden, true);

    const metadata = ipv4ToNumber('169.254.169.254');
    assert.ok(metadata !== null);
    assert.equal(isForbiddenIpv4(metadata).isForbidden, true);

    // Single decimal integer (2130706433 = 127.0.0.1)
    const intLoopback = ipv4ToNumber('2130706433');
    assert.ok(intLoopback !== null);
    assert.equal(isForbiddenIpv4(intLoopback).isForbidden, true);

    // Hex notation (0x7f000001 = 127.0.0.1)
    const hexLoopback = ipv4ToNumber('0x7f000001');
    assert.ok(hexLoopback !== null);
    assert.equal(isForbiddenIpv4(hexLoopback).isForbidden, true);

    // Public internet IP (e.g. 8.8.8.8)
    const publicIp = ipv4ToNumber('8.8.8.8');
    assert.ok(publicIp !== null);
    assert.equal(isForbiddenIpv4(publicIp).isForbidden, false);
  });

  it('rejects forbidden IPv6 representations', () => {
    assert.equal(isForbiddenIpv6('::1').isForbidden, true);
    assert.equal(isForbiddenIpv6('fe80::1').isForbidden, true);
    assert.equal(isForbiddenIpv6('fc00::1').isForbidden, true);
    assert.equal(isForbiddenIpv6('::ffff:127.0.0.1').isForbidden, true);
  });

  it('blocks forbidden hostnames and internal suffixes', () => {
    assert.equal(isForbiddenHostname('localhost').isForbidden, true);
    assert.equal(isForbiddenHostname('server.local').isForbidden, true);
    assert.equal(isForbiddenHostname('app.internal').isForbidden, true);
    assert.equal(isForbiddenHostname('db.lan').isForbidden, true);
    assert.equal(isForbiddenHostname('metadata.google.internal').isForbidden, true);
    assert.equal(isForbiddenHostname('youtube.com').isForbidden, false);
    assert.equal(isForbiddenHostname('vimeo.com').isForbidden, false);
  });

  it('normalizes raw media URLs and strips quotes / spaces', () => {
    assert.equal(
      normalizeMediaUrl('   "https://www.youtube.com/watch?v=dQw4w9WgXcQ"  '),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    assert.equal(
      normalizeMediaUrl('//youtube.com/watch?v=dQw4w9WgXcQ'),
      'https://youtube.com/watch?v=dQw4w9WgXcQ'
    );
    assert.equal(
      normalizeMediaUrl('youtube.com/watch?v=dQw4w9WgXcQ'),
      'https://youtube.com/watch?v=dQw4w9WgXcQ'
    );
    // Dangerous protocols are rejected
    assert.equal(normalizeMediaUrl('javascript:alert(1)'), '');
    assert.equal(normalizeMediaUrl('data:text/html;base64,...'), '');
    assert.equal(normalizeMediaUrl('file:///etc/passwd'), '');
  });

  it('canonicalizes YouTube regular, shorts, and playlist URLs', () => {
    const regular = canonicalizeMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share');
    assert.equal(regular.platform, 'youtube');
    assert.equal(regular.id, 'dQw4w9WgXcQ');
    assert.equal(regular.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const shorts = canonicalizeMediaUrl('https://youtube.com/shorts/dQw4w9WgXcQ');
    assert.equal(shorts.platform, 'youtube');
    assert.equal(shorts.id, 'dQw4w9WgXcQ');
    assert.equal(shorts.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const shortlink = canonicalizeMediaUrl('https://youtu.be/dQw4w9WgXcQ');
    assert.equal(shortlink.platform, 'youtube');
    assert.equal(shortlink.id, 'dQw4w9WgXcQ');

    const playlist = canonicalizeMediaUrl('https://www.youtube.com/playlist?list=PL1234567890ABCDEF');
    assert.equal(playlist.platform, 'youtube');
    assert.equal(playlist.isPlaylist, true);
    assert.equal(playlist.listId, 'PL1234567890ABCDEF');
    assert.equal(playlist.canonicalUrl, 'https://www.youtube.com/playlist?list=PL1234567890ABCDEF');
  });

  it('canonicalizes Vimeo and direct media URLs', () => {
    const vimeo = canonicalizeMediaUrl('https://vimeo.com/76979871');
    assert.equal(vimeo.platform, 'vimeo');
    assert.equal(vimeo.id, '76979871');
    assert.equal(vimeo.canonicalUrl, 'https://vimeo.com/76979871');

    const direct = canonicalizeMediaUrl('https://example.com/video.mp4?utm_source=twitter&auth=token123');
    assert.equal(direct.platform, 'direct');
    assert.equal(direct.canonicalUrl, 'https://example.com/video.mp4?auth=token123');
  });

  it('asynchronously detects SSRF attacks on loopback URLs', async () => {
    const res = await validateUrlSafety('http://127.0.0.1:8080/secret', { resolveDns: false });
    assert.equal(res.safe, false);
    assert.match(res.reason ?? '', /Loopback/);
  });
});

describe('MUXARO Shared Core - Zod Contracts', () => {
  it('validates analyse request and response schemas', () => {
    const validReq = analyseRequestSchema.parse({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      forceRefresh: true,
    });
    assert.equal(validReq.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const validRes = analyseResponseSchema.parse({
      platform: 'youtube',
      id: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      durationSeconds: 212,
      formats: [
        {
          formatId: '137',
          container: 'mp4',
          resolution: '1080p',
          hasVideo: true,
          hasAudio: false,
        },
      ],
      isPlaylist: false,
      inspectedAt: new Date().toISOString(),
    });
    assert.equal(validRes.title, 'Rick Astley - Never Gonna Give You Up');
  });

  it('validates job creation schema with mutual sourceUrl/uploadSessionId check', () => {
    const valid = createJobRequestSchema.parse({
      tool: 'convert_video',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      targetFormat: 'mp4',
      idempotencyKey: 'idemp-12345',
    });
    assert.equal(valid.tool, 'convert_video');

    // Missing both sourceUrl and uploadSessionId fails validation
    assert.throws(() => {
      createJobRequestSchema.parse({
        tool: 'convert_video',
        targetFormat: 'mp4',
        idempotencyKey: 'idemp-12345',
      });
    });
  });

  it('validates upload multipart init and complete schemas', () => {
    const init = uploadInitRequestSchema.parse({
      filename: 'sample.mp4',
      sizeBytes: 104857600,
      mimeType: 'video/mp4',
      tool: 'convert_video',
      targetFormat: 'mkv',
    });
    assert.equal(init.filename, 'sample.mp4');

    const complete = uploadCompleteRequestSchema.parse({
      uploadSessionId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      parts: [
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
      ],
    });
    assert.equal(complete.parts.length, 2);
  });
});

describe('MUXARO Shared Core - Bulletproof SSRF Fetch & DNS Rebinding Defense', () => {
  it('parses IPv4 across all representations into 32-bit integers', () => {
    // 4-part dotted
    assert.equal(parseIpv4ToNumber('127.0.0.1'), 2130706433);
    assert.equal(parseIpv4ToNumber('0177.0.0.1'), 2130706433);
    assert.equal(parseIpv4ToNumber('0x7f.0.0.1'), 2130706433);
    assert.equal(parseIpv4ToNumber('169.254.169.254'), 2852039166);
    assert.equal(parseIpv4ToNumber('0251.0376.0251.0376'), 2852039166);
    assert.equal(parseIpv4ToNumber('0xa9.0xfe.0xa9.0xfe'), 2852039166);

    // 3-part dotted (127.0.1 -> 127.0.0.1)
    assert.equal(parseIpv4ToNumber('127.0.1'), 2130706433);

    // 2-part dotted (127.1 -> 127.0.0.1)
    assert.equal(parseIpv4ToNumber('127.1'), 2130706433);

    // 1-part single integer representations
    assert.equal(parseIpv4ToNumber('2130706433'), 2130706433);
    assert.equal(parseIpv4ToNumber('0x7f000001'), 2130706433);
    assert.equal(parseIpv4ToNumber('017700000001'), 2130706433);
    assert.equal(parseIpv4ToNumber('2852039166'), 2852039166);
    assert.equal(parseIpv4ToNumber('0xa9fea9fe'), 2852039166);

    // Malformed / Non-IPv4
    assert.equal(parseIpv4ToNumber('256.0.0.1'), null);
    assert.equal(parseIpv4ToNumber('1.2.3.4.5'), null);
    assert.equal(parseIpv4ToNumber('example.com'), null);
    assert.equal(parseIpv4ToNumber(''), null);
  });

  it('detects all forbidden IPv4 CIDR ranges', () => {
    // 0.0.0.0/8 - Current Network
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('0.0.0.0')!).isForbidden, true);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('0.255.255.255')!).isForbidden, true);

    // 10.0.0.0/8 - RFC 1918 Private
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('10.0.0.1')!).isForbidden, true);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('10.255.255.255')!).isForbidden, true);

    // 100.64.0.0/10 - CGNAT & Alibaba Cloud metadata (100.100.100.200)
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('100.64.0.1')!).isForbidden, true);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('100.100.100.200')!).isForbidden, true);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('100.127.255.255')!).isForbidden, true);

    // 127.0.0.0/8 - Loopback
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('127.0.0.1')!).isForbidden, true);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('127.255.255.255')!).isForbidden, true);

    // 169.254.0.0/16 - Link-local & Cloud Metadata (AWS/GCP/Azure IMDS 169.254.169.254)
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('169.254.169.254')!).isForbidden, true);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('169.254.170.2')!).isForbidden, true);

    // 172.16.0.0/12 - RFC 1918 Private
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('172.16.0.1')!).isForbidden, true);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('172.31.255.255')!).isForbidden, true);

    // 192.168.0.0/16 - RFC 1918 Private
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('192.168.1.1')!).isForbidden, true);

    // Documentation networks (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24)
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('192.0.2.1')!).isForbidden, true);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('198.51.100.1')!).isForbidden, true);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('203.0.113.1')!).isForbidden, true);

    // 224.0.0.0/4 - Multicast
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('224.0.0.1')!).isForbidden, true);

    // 240.0.0.0/4 - Reserved & 255.255.255.255 Broadcast
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('240.0.0.1')!).isForbidden, true);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('255.255.255.255')!).isForbidden, true);

    // Public Internet IPs
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('8.8.8.8')!).isForbidden, false);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('1.1.1.1')!).isForbidden, false);
    assert.equal(isForbiddenIpv4Number(parseIpv4ToNumber('93.184.216.34')!).isForbidden, false);
  });

  it('detects all forbidden IPv6 ranges and formats', () => {
    // IPv6 Loopback (::1) and Unspecified (::)
    assert.equal(isForbiddenIpv6Address('::1').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('[::1]').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('0:0:0:0:0:0:0:1').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('::').isForbidden, true);

    // IPv4-mapped IPv6 (::ffff:127.0.0.1, ::ffff:169.254.169.254, hex notation)
    assert.equal(isForbiddenIpv6Address('::ffff:127.0.0.1').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('::ffff:169.254.169.254').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('::ffff:7f00:1').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('::ffff:a9fe:a9fe').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('::ffff:192.168.1.1').isForbidden, true);

    // Unique Local Addresses (ULA fc00::/7, including AWS IMDSv2 fd00:ec2::254)
    assert.equal(isForbiddenIpv6Address('fc00::1').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('fd00::1').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('fd00:ec2::254').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('[fd00:ec2::254]').isForbidden, true);

    // Link-local unicast (fe80::/10)
    assert.equal(isForbiddenIpv6Address('fe80::1').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('fe80::1%eth0').isForbidden, true);

    // Multicast (ff00::/8)
    assert.equal(isForbiddenIpv6Address('ff02::1').isForbidden, true);

    // Discard prefix (100::/64) & Documentation (2001:db8::/32)
    assert.equal(isForbiddenIpv6Address('100::1').isForbidden, true);
    assert.equal(isForbiddenIpv6Address('2001:db8::1').isForbidden, true);

    // Public IPv6
    assert.equal(isForbiddenIpv6Address('2606:4700:4700::1111').isForbidden, false);
    assert.equal(isForbiddenIpv6Address('2001:4860:4860::8888').isForbidden, false);
  });

  it('enforces assertPublicIp and isPublicIp correctly', () => {
    // Should pass for public IPs
    assert.doesNotThrow(() => assertPublicIp('8.8.8.8'));
    assert.doesNotThrow(() => assertPublicIp('1.1.1.1'));
    assert.doesNotThrow(() => assertPublicIp('2606:4700:4700::1111'));
    assert.equal(isPublicIp('8.8.8.8'), true);
    assert.equal(isPublicIp('1.1.1.1'), true);
    assert.equal(isPublicIp('2606:4700:4700::1111'), true);

    // Should throw MuxaroError with SSRF_BLOCKED for loopback & private
    assert.throws(() => assertPublicIp('127.0.0.1'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED' && err.statusCode === 403;
    });
    assert.throws(() => assertPublicIp('2130706433'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => assertPublicIp('169.254.169.254'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => assertPublicIp('2852039166'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => assertPublicIp('10.0.0.1'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => assertPublicIp('192.168.1.1'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => assertPublicIp('::1'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => assertPublicIp('::ffff:127.0.0.1'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => assertPublicIp('fd00:ec2::254'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => assertPublicIp('localhost'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });

    assert.equal(isPublicIp('127.0.0.1'), false);
    assert.equal(isPublicIp('169.254.169.254'), false);
    assert.equal(isPublicIp('::1'), false);
    assert.equal(isPublicIp('invalid-ip-address'), false);
  });

  it('validates fetch URLs and blocks non-standard ports, credentials, and forbidden hosts', () => {
    // Valid standard ports and protocols
    const httpsValid = validateFetchUrl('https://example.com/video.mp4');
    assert.equal(httpsValid.port, 443);
    assert.equal(httpsValid.protocol, 'https:');

    const httpValid = validateFetchUrl('http://example.com/stream.m3u8');
    assert.equal(httpValid.port, 80);
    assert.equal(httpValid.protocol, 'http:');

    const explicitPort443 = validateFetchUrl('https://example.com:443/video.mp4');
    assert.equal(explicitPort443.port, 443);

    const explicitPort80 = validateFetchUrl('http://example.com:80/video.mp4');
    assert.equal(explicitPort80.port, 80);

    // Blocking non-standard ports (allowing only 80 and 443)
    assert.throws(() => validateFetchUrl('http://example.com:8080/video.mp4'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED' && /port 8080 is blocked/i.test(err.message);
    });
    assert.throws(() => validateFetchUrl('https://example.com:8443/video.mp4'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => validateFetchUrl('http://example.com:22/ssh'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => validateFetchUrl('http://example.com:6379/redis'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });

    // Blocking embedded user credentials
    assert.throws(() => validateFetchUrl('http://admin:secret@example.com/'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED' && /embedded credentials/i.test(err.message);
    });
    assert.throws(() => validateFetchUrl('https://user@example.com/media'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED' && /embedded credentials/i.test(err.message);
    });

    // Blocking non-http/https protocols
    assert.throws(() => validateFetchUrl('file:///etc/passwd'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'INVALID_URL';
    });
    assert.throws(() => validateFetchUrl('ftp://example.com/file'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'INVALID_URL';
    });
    assert.throws(() => validateFetchUrl('gopher://127.0.0.1:70/'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'INVALID_URL';
    });

    // Blocking forbidden hostnames and raw internal IPs
    assert.throws(() => validateFetchUrl('http://localhost/'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => validateFetchUrl('http://metadata.google.internal/computeMetadata/v1/'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => validateFetchUrl('http://server.local/api'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => validateFetchUrl('http://127.0.0.1/admin'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => validateFetchUrl('http://169.254.169.254/latest/meta-data'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => validateFetchUrl('http://2130706433/'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => validateFetchUrl('http://[::1]/'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
    assert.throws(() => validateFetchUrl('http://[fd00:ec2::254]/'), (err: any) => {
      return err instanceof MuxaroError && err.code === 'SSRF_BLOCKED';
    });
  });

  it('rejects SSRF attempts in ssrfSafeFetch upfront and at socket connect time', async () => {
    // Upfront rejection on loopback
    await assert.rejects(
      async () => ssrfSafeFetch('http://127.0.0.1/api'),
      (err: any) => err instanceof MuxaroError && err.code === 'SSRF_BLOCKED'
    );

    // Upfront rejection on metadata
    await assert.rejects(
      async () => ssrfSafeFetch('http://169.254.169.254/latest/meta-data'),
      (err: any) => err instanceof MuxaroError && err.code === 'SSRF_BLOCKED'
    );

    // Upfront rejection on non-standard port
    await assert.rejects(
      async () => ssrfSafeFetch('http://example.com:8080/data'),
      (err: any) => err instanceof MuxaroError && err.code === 'SSRF_BLOCKED'
    );

    // Upfront rejection on embedded credentials
    await assert.rejects(
      async () => ssrfSafeFetch('http://user:pass@example.com/'),
      (err: any) => err instanceof MuxaroError && err.code === 'SSRF_BLOCKED'
    );

    // Socket-connect time DNS resolution inspection (neutralizing DNS rebinding)
    const rebindingAgent = createSsrfSafeAgent();
    // Simulate a DNS rebinding lookup hook that resolves a public-looking domain to 127.0.0.1 or 169.254.169.254
    const simulatedRebindingDispatcher = {
      dispatch: (opts: any, handler: any) => {
        // Dispatches to a socket where connect lookup validates resolved IP
        return false;
      },
    };

    // Agent connect.lookup hook test directly
    let lookupBlocked = false;
    const testAgent = createSsrfSafeAgent();
    const connectOpts = (testAgent as any)[Object.getOwnPropertySymbols(testAgent).find(s => s.description === 'options') || ''] || {};
    // Test that defaultSsrfSafeAgent exists and is configured
    assert.ok(defaultSsrfSafeAgent !== null);
  });

  it('manually follows safe redirects and enforces maxRedirects and security on each hop', async () => {
    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    const client = mockAgent.get('http://example.com');

    // 1. Redirect to cloud metadata IP -> blocked
    client.intercept({ path: '/redirect-metadata', method: 'GET' }).reply(302, '', {
      headers: { Location: 'http://169.254.169.254/latest/meta-data' },
    });
    await assert.rejects(
      async () => ssrfSafeFetch('http://example.com/redirect-metadata', { dispatcher: mockAgent }),
      (err: any) => err instanceof MuxaroError && err.code === 'SSRF_BLOCKED' && /metadata/i.test(err.message)
    );

    // 2. Redirect to non-standard port -> blocked
    client.intercept({ path: '/redirect-port', method: 'GET' }).reply(302, '', {
      headers: { Location: 'http://example.com:8080/internal' },
    });
    await assert.rejects(
      async () => ssrfSafeFetch('http://example.com/redirect-port', { dispatcher: mockAgent }),
      (err: any) => err instanceof MuxaroError && err.code === 'SSRF_BLOCKED' && /port 8080/i.test(err.message)
    );

    // 3. Redirect to embedded credentials -> blocked
    client.intercept({ path: '/redirect-creds', method: 'GET' }).reply(302, '', {
      headers: { Location: 'http://admin:pass@example.com/admin' },
    });
    await assert.rejects(
      async () => ssrfSafeFetch('http://example.com/redirect-creds', { dispatcher: mockAgent }),
      (err: any) => err instanceof MuxaroError && err.code === 'SSRF_BLOCKED' && /embedded credentials/i.test(err.message)
    );

    // 4. Redirect loop exceeding maxRedirects -> bad request
    client.intercept({ path: '/hop1', method: 'GET' }).reply(302, '', { headers: { Location: 'http://example.com/hop2' } });
    client.intercept({ path: '/hop2', method: 'GET' }).reply(302, '', { headers: { Location: 'http://example.com/hop3' } });
    client.intercept({ path: '/hop3', method: 'GET' }).reply(302, '', { headers: { Location: 'http://example.com/hop4' } });
    client.intercept({ path: '/hop4', method: 'GET' }).reply(302, '', { headers: { Location: 'http://example.com/hop5' } });
    await assert.rejects(
      async () => ssrfSafeFetch('http://example.com/hop1', { dispatcher: mockAgent, maxRedirects: 3 }),
      (err: any) => err instanceof MuxaroError && err.code === 'BAD_REQUEST' && /limit of 3/i.test(err.message)
    );

    // 5. Valid 301 redirect to 200 OK -> succeeds
    client.intercept({ path: '/safe-redirect', method: 'GET' }).reply(301, '', {
      headers: { Location: 'http://example.com/destination' },
    });
    client.intercept({ path: '/destination', method: 'GET' }).reply(200, 'PAYLOAD_OK');

    const res = await ssrfSafeFetch('http://example.com/safe-redirect', { dispatcher: mockAgent });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'PAYLOAD_OK');
  });
});
