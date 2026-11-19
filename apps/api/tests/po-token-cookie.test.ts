import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveCookiesArg,
  materializeCookieContent,
  formatPoToken,
  buildYouTubeExtractorArg,
  resolveBgUtilBaseUrl,
  buildResilientYtDlpArgs,
  poTokenCookieService,
  DEFAULT_PLAYER_CLIENTS,
} from '../src/services/po-token-cookie.service.js';

test('PO Token & Cookie Provider Suite', async (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  await t.test('1. formatPoToken formats plain tokens and visitorData correctly', () => {
    // Plain token without prefix defaults to web+
    assert.equal(formatPoToken('ABC123XYZ'), 'web+ABC123XYZ');

    // Token already containing client prefix is preserved
    assert.equal(formatPoToken('ios+DEF456'), 'ios+DEF456');
    assert.equal(formatPoToken('android+GHI789'), 'android+GHI789');

    // Token with visitorData appended
    assert.equal(formatPoToken('ABC123XYZ', 'visData42'), 'web+ABC123XYZ+visData42');

    // Token with visitorData already present does not duplicate it
    assert.equal(formatPoToken('web+ABC123XYZ+visData42', 'visData42'), 'web+ABC123XYZ+visData42');

    // Empty token returns empty string
    assert.equal(formatPoToken('   '), '');
  });

  await t.test('2. buildYouTubeExtractorArg formats player client chain and PO token', () => {
    // Default without PO token
    delete process.env.YTDLP_PLAYER_CLIENTS;
    delete process.env.YTDLP_PO_TOKEN;
    delete process.env.YTDLP_VISITOR_DATA;

    const def = buildYouTubeExtractorArg();
    assert.equal(def.extractorArg, `youtube:player_client=${DEFAULT_PLAYER_CLIENTS}`);
    assert.equal(def.hasPoToken, false);

    // Custom client chain via option
    const custom = buildYouTubeExtractorArg({ playerClient: 'tv,mweb' });
    assert.equal(custom.extractorArg, 'youtube:player_client=tv,mweb');

    // PO token injected via option
    const withPo = buildYouTubeExtractorArg({
      playerClient: 'ios,android,web',
      poToken: 'sample_token_777',
      visitorData: 'visitor_hash_888',
    });
    assert.equal(
      withPo.extractorArg,
      'youtube:player_client=ios,android,web;po_token=web+sample_token_777+visitor_hash_888'
    );
    assert.equal(withPo.hasPoToken, true);

    // PO token injected via environment variables
    process.env.YTDLP_PO_TOKEN = 'env_po_token_999';
    process.env.YTDLP_VISITOR_DATA = 'env_vis_111';
    const withEnvPo = buildYouTubeExtractorArg();
    assert.ok(withEnvPo.extractorArg.includes('po_token=web+env_po_token_999+env_vis_111'));
    assert.equal(withEnvPo.hasPoToken, true);
  });

  await t.test('3. resolveBgUtilBaseUrl only returns URL when explicitly configured', () => {
    delete process.env.BGUTIL_BASE_URL;
    delete process.env.YTDLP_BGUTIL_URL;
    delete process.env.POT_PROVIDER_URL;

    // Never returns dead hardcoded Docker IP
    assert.equal(resolveBgUtilBaseUrl(), null);

    // Returns explicitly passed override
    assert.equal(resolveBgUtilBaseUrl('http://custom-sidecar:4416'), 'http://custom-sidecar:4416');

    // Returns environment variable
    process.env.BGUTIL_BASE_URL = 'http://10.0.0.5:4416';
    assert.equal(resolveBgUtilBaseUrl(), 'http://10.0.0.5:4416');
  });

  await t.test('4. materializeCookieContent safely writes cookies to disk with restricted permissions', () => {
    const dummyCookies = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tVISITOR_INFO1_LIVE\ttest_visitor\n';
    const filePath = materializeCookieContent(dummyCookies);

    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('VISITOR_INFO1_LIVE'));

    // Check non-zero size
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 0);

    // Empty content throws error
    assert.throws(() => materializeCookieContent('   '), /empty/i);
  });

  await t.test('5. resolveCookiesArg resolves cookies from path, env var, base64, and browser', () => {
    delete process.env.YTDLP_COOKIES_CONTENT;
    delete process.env.YTDLP_COOKIES;
    delete process.env.YTDLP_COOKIES_BASE64;
    delete process.env.YTDLP_COOKIES_PATH;
    delete process.env.YTDLP_COOKIES_FROM_BROWSER;

    // A. Explicit cookies content option
    const rawNetscape = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tPREF\tf1=50000000\n';
    const fromContent = resolveCookiesArg({ cookiesContent: rawNetscape });
    assert.equal(fromContent.hasCookies, true);
    assert.equal(fromContent.args[0], '--cookies');
    assert.ok(fs.existsSync(fromContent.args[1]));

    // B. Raw environment variable YTDLP_COOKIES_CONTENT
    process.env.YTDLP_COOKIES_CONTENT = rawNetscape;
    const fromEnvContent = resolveCookiesArg();
    assert.equal(fromEnvContent.hasCookies, true);
    assert.equal(fromEnvContent.source, 'env_content');
    assert.equal(fromEnvContent.args[0], '--cookies');
    delete process.env.YTDLP_COOKIES_CONTENT;

    // C. Base64 environment variable YTDLP_COOKIES_BASE64
    const b64 = Buffer.from(rawNetscape, 'utf8').toString('base64');
    process.env.YTDLP_COOKIES_BASE64 = b64;
    const fromB64 = resolveCookiesArg();
    assert.equal(fromB64.hasCookies, true);
    assert.equal(fromB64.source, 'env_base64');
    assert.equal(fromB64.args[0], '--cookies');
    delete process.env.YTDLP_COOKIES_BASE64;

    // D. Explicit file path
    const tempCookieFile = path.join(os.tmpdir(), `test-cookie-${Date.now()}.txt`);
    fs.writeFileSync(tempCookieFile, rawNetscape, 'utf8');
    process.env.YTDLP_COOKIES_PATH = tempCookieFile;
    const fromPath = resolveCookiesArg();
    assert.equal(fromPath.hasCookies, true);
    assert.equal(fromPath.source, 'direct_path');
    assert.equal(fromPath.args[1], tempCookieFile);
    delete process.env.YTDLP_COOKIES_PATH;
    try { fs.unlinkSync(tempCookieFile); } catch {}

    // E. Browser extraction
    process.env.YTDLP_COOKIES_FROM_BROWSER = 'firefox';
    const fromBrowser = resolveCookiesArg();
    assert.equal(fromBrowser.hasCookies, true);
    assert.equal(fromBrowser.source, 'browser');
    assert.deepEqual(fromBrowser.args, ['--cookies-from-browser', 'firefox']);
    delete process.env.YTDLP_COOKIES_FROM_BROWSER;
  });

  await t.test('6. buildResilientYtDlpArgs constructs complete anti-bot argument array', () => {
    delete process.env.BGUTIL_BASE_URL;
    delete process.env.YTDLP_BGUTIL_URL;
    delete process.env.POT_PROVIDER_URL;
    delete process.env.YTDLP_PO_TOKEN;
    delete process.env.YTDLP_COOKIES_CONTENT;
    delete process.env.YTDLP_PROXY;

    const args = buildResilientYtDlpArgs({
      playerClient: 'ios,android,tv,mweb,web',
    });

    // Validates essential anti-bot & performance flags
    assert.ok(args.includes('--no-playlist'));
    assert.ok(args.includes('--no-cache-dir'));
    assert.ok(args.includes('--no-warnings'));
    assert.ok(args.includes('--js-runtimes'));
    assert.ok(args.includes('--socket-timeout'));

    // Validates player_client extractor arg
    const extIdx = args.indexOf('--extractor-args');
    assert.ok(extIdx !== -1);
    assert.ok(args[extIdx + 1].includes('youtube:player_client=ios,android,tv,mweb,web'));

    // Does NOT include desktop Chrome user-agent for mobile client chains (avoids signature mismatch)
    assert.equal(args.includes('--user-agent'), false);

    // When client is strictly desktop web, user-agent is included
    const webArgs = buildResilientYtDlpArgs({ playerClient: 'web' });
    assert.ok(webArgs.includes('--user-agent'));

    // When proxy is specified
    const proxyArgs = buildResilientYtDlpArgs({ proxy: 'http://127.0.0.1:8080' });
    assert.ok(proxyArgs.includes('--proxy'));
    assert.equal(proxyArgs[proxyArgs.indexOf('--proxy') + 1], 'http://127.0.0.1:8080');
  });

  await t.test('7. poTokenCookieService class exposes unified API', () => {
    assert.ok(typeof poTokenCookieService.resolveCookies === 'function');
    assert.ok(typeof poTokenCookieService.materializeCookies === 'function');
    assert.ok(typeof poTokenCookieService.buildPoTokenExtractorArg === 'function');
    assert.ok(typeof poTokenCookieService.buildYtDlpArgs === 'function');
  });
});
