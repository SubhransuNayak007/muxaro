/**
 * Project MUXARO - Turboflow & yt-dlp Anti-Bot Resiliency Test Suite
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getYtDlpBaseArgs,
  isBotVerificationError,
  BotVerificationError,
  runWithYtDlpClientChain,
  mapHumanFriendlyError,
  selectTurboFlowStrategy,
  YTDLP_DEFAULT_PLAYER_CLIENTS,
  is8KResolution,
  get8KYtDlpFormatSelector,
} from '../src/services/turboflow.service.js';
import {
  mediaProcessorService,
  MediaProcessorService,
} from '../src/services/media-processor.service.js';

describe('TurboFlow yt-dlp Anti-Bot & Extractor Suite', () => {
  // Test 1: Base args generation and anti-bot flags
  test('getYtDlpBaseArgs generates resilient extractor args with mobile/TV client fallback', () => {
    const args = getYtDlpBaseArgs();

    assert.ok(args.includes('--js-runtimes'));
    assert.ok(args.includes('deno'));
    assert.ok(args.includes('node'));
    assert.ok(args.includes('--extractor-args'));

    const extractorArgIndex = args.indexOf('--extractor-args');
    assert.ok(extractorArgIndex !== -1);
    const extractorVal = args[extractorArgIndex + 1];
    assert.ok(extractorVal.includes('youtube:player_client='));
    assert.ok(extractorVal.includes('ios'));
    assert.ok(extractorVal.includes('android'));

    // Verify hardcoded 172.17.0.1 dead IP is eliminated
    const joined = args.join(' ');
    assert.ok(!joined.includes('172.17.0.1:4416'), 'Must not hardcode unreachable Docker IP');
  });

  // Test 2: Custom player client specification
  test('getYtDlpBaseArgs accepts custom player client chain', () => {
    const androidWebArgs = getYtDlpBaseArgs({ playerClient: 'android,web' });
    const joined = androidWebArgs.join(' ');
    assert.ok(joined.includes('youtube:player_client=android,web'));

    const mwebIosArgs = getYtDlpBaseArgs({ playerClient: 'mweb,ios' });
    assert.ok(mwebIosArgs.join(' ').includes('youtube:player_client=mweb,ios'));
  });

  // Test 3: Detection of YouTube bot verification blocks
  test('isBotVerificationError identifies all BotGuard and datacenter challenge variants', () => {
    assert.equal(isBotVerificationError('Sign in to confirm you’re not a bot. This helps protect our community.'), true);
    assert.equal(isBotVerificationError("confirm you're not a bot"), true);
    assert.equal(isBotVerificationError('ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot'), true);
    assert.equal(isBotVerificationError('HTTP Error 429: Too Many Requests'), true);
    assert.equal(isBotVerificationError({ code: 'ERR_BOT_VERIFICATION_REQUIRED', message: 'Failed' }), true);
    assert.equal(isBotVerificationError({ stderr: 'unplayable: requires bot verification' }), true);
    assert.equal(isBotVerificationError('YouTube requires verification for this stream on cloud servers'), true);

    // Negative tests: standard errors should not be classified as bot check
    assert.equal(isBotVerificationError('File not found 404'), false);
    assert.equal(isBotVerificationError('Disk full'), false);
    assert.equal(isBotVerificationError(null), false);
  });

  // Test 4: Friendly error mapping cleanly surfaces MUXARO Direct guidance
  test('mapHumanFriendlyError maps bot blocks to MUXARO Direct copy', () => {
    const directCopy =
      'YouTube requires verification for this stream on cloud servers. Use MUXARO Direct to download seamlessly from your browser.';

    assert.equal(mapHumanFriendlyError('ERR_BOT_VERIFICATION_REQUIRED'), directCopy);
    assert.equal(mapHumanFriendlyError(undefined, "Sign in to confirm you're not a bot"), directCopy);
    assert.equal(mapHumanFriendlyError(undefined, 'Sign in to confirm you’re not a bot. This helps protect our community.'), directCopy);
    assert.equal(mapHumanFriendlyError('BOT_DETECTED'), directCopy);
    assert.equal(mapHumanFriendlyError(undefined, 'YouTube requires verification for this stream on cloud servers'), directCopy);
  });

  // Test 5: Fallback client chain execution retry
  test('runWithYtDlpClientChain retries with fallback client chain when bot verification occurs', async () => {
    const attempts: string[] = [];

    const result = await runWithYtDlpClientChain(async (clientChain) => {
      attempts.push(clientChain);
      if (attempts.length === 1) {
        throw new Error("Sign in to confirm you're not a bot");
      }
      return `SUCCESS_ON_${clientChain}`;
    });

    assert.equal(attempts.length, 2);
    assert.equal(attempts[0], 'ios,android,tv,mweb,web');
    assert.equal(attempts[1], 'tv,mweb');
    assert.equal(result, 'SUCCESS_ON_tv,mweb');
  });

  // Test 6: Fallback client chain exhausts with BotVerificationError
  test('runWithYtDlpClientChain throws BotVerificationError when all clients are blocked', async () => {
    await assert.rejects(
      async () => {
        await runWithYtDlpClientChain(async () => {
          throw new Error('Sign in to confirm you’re not a bot');
        });
      },
      (err: any) => {
        assert.equal(err.code, 'ERR_BOT_VERIFICATION_REQUIRED');
        assert.ok(err.userMessage.includes('MUXARO Direct'));
        assert.equal(err.botBlocked, true);
        return true;
      }
    );
  });

  // Test 7: MediaProcessorService singleton & instance methods
  test('MediaProcessorService operates correctly and exposes matching interface', () => {
    assert.ok(mediaProcessorService instanceof MediaProcessorService);
    assert.equal(mediaProcessorService.isBotBlocked("confirm you're not a bot"), true);
    const args = mediaProcessorService.buildYtDlpArgs({ playerClient: 'android,web' });
    assert.ok(args.join(' ').includes('player_client=android,web'));
    const mapped = mediaProcessorService.mapError('ERR_BOT_VERIFICATION_REQUIRED');
    assert.ok(mapped.includes('MUXARO Direct'));
  });

  // Test 8: 8K Ultra HD Detection, Stream Pairing Selector & TurboFlow Strategy
  test('8K Ultra HD Resolution Detection & Stream Pairing Selector', () => {
    assert.equal(is8KResolution('8K'), true);
    assert.equal(is8KResolution('8k (4320p)'), true);
    assert.equal(is8KResolution('4320p'), true);
    assert.equal(is8KResolution(undefined, 4320), true);
    assert.equal(is8KResolution(undefined, undefined, 7680), true);
    assert.equal(is8KResolution('1080p'), false);

    const mp4Selector = get8KYtDlpFormatSelector('mp4');
    assert.ok(mp4Selector.includes('bestvideo[height>=4320]'));
    assert.ok(mp4Selector.includes('bestaudio'));

    const webmSelector = get8KYtDlpFormatSelector('webm');
    assert.ok(webmSelector.includes('bestvideo[height>=4320]'));
  });

  test('selectTurboFlowStrategy routes 8K compatible streams to Instant Lane lossless remux', () => {
    const strategy = selectTurboFlowStrategy({
      operation: 'CONVERT_FORMAT',
      targetFormat: 'mp4',
      targetResolution: '8K',
      streamCopy: true,
      sourceAsset: {
        id: 'asset-8k-1',
        title: '8K Test Asset',
        durationSeconds: 120,
        streams: [
          { type: 'VIDEO', codec: 'h264', width: 7680, height: 4320 },
          { type: 'AUDIO', codec: 'aac', sampleRate: 48000 },
        ],
      },
    });

    assert.equal(strategy.processingLane, 'instant');
    assert.equal(strategy.queueClass, 'instant-processing');
    assert.equal(strategy.losslessPreserved, true);
    assert.equal(strategy.requiresVideoTranscode, false);
    assert.equal(strategy.strategyLabel, '8K Lossless Stream Remux');
  });
});
