/**
 * MUXARO Link Handling & Normalization Regression Test Suite
 * Test File: tests/unit/link-handling-regression.test.ts
 *
 * Verifies that the "link-not-showing" bug is permanently fixed:
 * 1. Protocol-less inputs (e.g. 'youtube.com/watch?v=...') are auto-normalized to 'https://...'
 * 2. Whitespace and surrounding quotes are safely trimmed
 * 3. Dangerous pseudo-protocols ('javascript:', 'data:', 'file:') are rejected cleanly
 * 4. Extremely long URLs (2000+ characters) parse and truncate safely without breaking layout
 * 5. Platform detection distinguishes YouTube, Vimeo, and direct media hosts
 * 6. isValidMediaUrl reliably distinguishes genuine media addresses from arbitrary strings
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeMediaUrl,
  isValidMediaUrl,
  formatDisplayUrl,
  detectPlatform,
} from '../../apps/web/lib/url-utils.ts';

describe('MUXARO Link Normalization — Root Cause Verification', () => {
  it('auto-prepends https:// when user inputs a protocol-less domain or video path', () => {
    assert.strictEqual(
      normalizeMediaUrl('youtube.com/watch?v=dQw4w9WgXcQ'),
      'https://youtube.com/watch?v=dQw4w9WgXcQ'
    );
    assert.strictEqual(
      normalizeMediaUrl('www.vimeo.com/76979871'),
      'https://www.vimeo.com/76979871'
    );
    assert.strictEqual(
      normalizeMediaUrl('commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'),
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
    );
    assert.strictEqual(
      normalizeMediaUrl('youtu.be/dQw4w9WgXcQ?si=abcdef123'),
      'https://youtu.be/dQw4w9WgXcQ?si=abcdef123'
    );
  });

  it('preserves existing https:// and http:// schemes without duplication', () => {
    assert.strictEqual(
      normalizeMediaUrl('https://youtube.com/watch?v=dQw4w9WgXcQ'),
      'https://youtube.com/watch?v=dQw4w9WgXcQ'
    );
    assert.strictEqual(
      normalizeMediaUrl('http://localhost:4000/media/test.mp4'),
      'http://localhost:4000/media/test.mp4'
    );
  });

  it('converts protocol-relative "//" links into https://', () => {
    assert.strictEqual(
      normalizeMediaUrl('//cdn.example.com/video.mp4'),
      'https://cdn.example.com/video.mp4'
    );
  });

  it('strips surrounding single or double quotes and trims all whitespace', () => {
    assert.strictEqual(
      normalizeMediaUrl('   "https://vimeo.com/12345"   '),
      'https://vimeo.com/12345'
    );
    assert.strictEqual(
      normalizeMediaUrl("  'youtube.com/watch?v=123'  "),
      'https://youtube.com/watch?v=123'
    );
    assert.strictEqual(
      normalizeMediaUrl('\n\t https://example.com/audio.mp3 \r\n'),
      'https://example.com/audio.mp3'
    );
  });

  it('rejects malicious or dangerous pseudo-protocols without crashing', () => {
    assert.strictEqual(normalizeMediaUrl('javascript:alert(document.cookie)'), '');
    assert.strictEqual(normalizeMediaUrl('data:text/html,<script>alert(1)</script>'), '');
    assert.strictEqual(normalizeMediaUrl('file:///C:/Windows/System32/cmd.exe'), '');
    assert.strictEqual(normalizeMediaUrl('vbscript:msgbox("test")'), '');
  });

  it('returns empty string for null, undefined, non-string, or empty input', () => {
    assert.strictEqual(normalizeMediaUrl(''), '');
    assert.strictEqual(normalizeMediaUrl('   '), '');
    assert.strictEqual(normalizeMediaUrl(null), '');
    assert.strictEqual(normalizeMediaUrl(undefined), '');
    assert.strictEqual(normalizeMediaUrl(12345), '');
    assert.strictEqual(normalizeMediaUrl({}), '');
  });
});

describe('MUXARO Link Validation (isValidMediaUrl)', () => {
  it('accepts valid video and media destinations', () => {
    assert.strictEqual(isValidMediaUrl('https://www.youtube.com/watch?v=test'), true);
    assert.strictEqual(isValidMediaUrl('youtube.com/watch?v=test'), true);
    assert.strictEqual(isValidMediaUrl('https://vimeo.com/45678'), true);
    assert.strictEqual(isValidMediaUrl('http://localhost:4000/sample.mp4'), true);
    assert.strictEqual(isValidMediaUrl('https://cdn.muxaro.app/video.mkv'), true);
  });

  it('rejects invalid, malformed, or malicious inputs', () => {
    assert.strictEqual(isValidMediaUrl(''), false);
    assert.strictEqual(isValidMediaUrl('just random words without host'), false);
    assert.strictEqual(isValidMediaUrl('javascript:alert(1)'), false);
    assert.strictEqual(isValidMediaUrl('data:image/png;base64,123'), false);
    assert.strictEqual(isValidMediaUrl(null), false);
  });
});

describe('MUXARO Display Formatter (formatDisplayUrl)', () => {
  it('strips www. and formats clean URLs', () => {
    const formatted = formatDisplayUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 50);
    assert.strictEqual(formatted, 'youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('gracefully handles ultra-long URLs (2000+ chars) with mid-string ellipsis', () => {
    const longParam = 'a'.repeat(2500);
    const longUrl = `https://example.com/watch?param=${longParam}`;
    const formatted = formatDisplayUrl(longUrl, 40);
    assert.ok(formatted.length <= 42, `Length should be capped, was ${formatted.length}`);
    assert.ok(formatted.includes('…'), 'Should contain ellipsis');
    assert.ok(formatted.startsWith('example.com/watch?param='), 'Should preserve start of URL');
  });

  it('handles empty or malformed inputs without throwing', () => {
    assert.strictEqual(formatDisplayUrl(''), '');
    assert.strictEqual(formatDisplayUrl('invalid-url-string', 30), 'invalid-url-string');
  });
});

describe('MUXARO Platform Detection (detectPlatform)', () => {
  it('identifies YouTube URLs including shortlinks', () => {
    assert.strictEqual(detectPlatform('https://www.youtube.com/watch?v=123').name, 'YouTube');
    assert.strictEqual(detectPlatform('youtube.com/shorts/abc').name, 'YouTube');
    assert.strictEqual(detectPlatform('https://youtu.be/123').name, 'YouTube');
  });

  it('identifies Vimeo URLs', () => {
    assert.strictEqual(detectPlatform('https://vimeo.com/76979871').name, 'Vimeo');
    assert.strictEqual(detectPlatform('vimeo.com/12345').name, 'Vimeo');
  });

  it('extracts clean hostnames for generic media sources', () => {
    assert.strictEqual(detectPlatform('https://storage.googleapis.com/video.mp4').name, 'storage.googleapis.com');
  });
});
