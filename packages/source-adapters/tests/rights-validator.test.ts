/**
 * Unit Tests: Rights Declaration Validation and Abuse Detection Filtering
 */

import assert from 'node:assert/strict';
import { RightsValidator, AbuseDetector } from '../src/rights-validator.ts';
import { RightsViolationError, AbuseDetectedError } from '../src/errors.ts';
import type { RightsDeclaration } from '../src/types.ts';

console.log('--- Running Rights Validator & Abuse Detection Tests ---');

// 1. Abuse Detection - Anomaly and Evasion checks
{
  // Clean URL
  const clean = AbuseDetector.check('https://cdn.example.com/assets/sample.mp4');
  assert.equal(clean.isSuspicious, false);
  assert.equal(clean.blocked, false);
  assert.doesNotThrow(() => AbuseDetector.assertSafe('https://cdn.example.com/assets/sample.mp4'));

  // Empty URL
  const empty = AbuseDetector.check('');
  assert.equal(empty.blocked, true);
  assert.ok(empty.flags.includes('EMPTY_URL'));

  // Shell injection attempts
  const shellSemicolon = AbuseDetector.check('https://cdn.example.com/file.mp4;cat%20/etc/passwd');
  assert.equal(shellSemicolon.blocked, true);
  assert.ok(shellSemicolon.flags.includes('SHELL_METACHARACTERS'));

  const shellPipe = AbuseDetector.check('https://cdn.example.com/file.mp4|reboot');
  assert.equal(shellPipe.blocked, true);
  assert.ok(shellPipe.flags.includes('SHELL_METACHARACTERS'));

  // Path traversal
  const traversal = AbuseDetector.check('https://cdn.example.com/media/../../secret/key.pem');
  assert.equal(traversal.blocked, true);
  assert.ok(traversal.flags.includes('PATH_TRAVERSAL_DETECTED'));

  // Credentials in URL
  const creds = AbuseDetector.check('https://admin:supersecret@cdn.example.com/file.mp4');
  assert.equal(creds.blocked, true);
  assert.ok(creds.flags.includes('EMBEDDED_CREDENTIALS'));

  // Forbidden query parameters trying to activate proxies/evasion
  const proxyParam = AbuseDetector.check('https://cdn.example.com/stream.mp4?rotate_proxy=true');
  assert.equal(proxyParam.blocked, true);

  const bypassParam = AbuseDetector.check('https://cdn.example.com/stream.mp4?bypass_protection=1');
  assert.equal(bypassParam.blocked, true);

  const captchaParam = AbuseDetector.check('https://cdn.example.com/stream.mp4?captcha_solver=auto');
  assert.equal(captchaParam.blocked, true);

  // Assert assertSafe throws AbuseDetectedError
  assert.throws(
    () => AbuseDetector.assertSafe('https://cdn.example.com/file.mp4;rm -rf /'),
    AbuseDetectedError
  );
}

// 2. Direct Media Rights Evaluation
{
  const testUrl = 'https://cdn.example.com/video.mp4';

  // No declaration: default direct media access permitted
  const resDefault = RightsValidator.evaluate(testUrl, undefined, 'direct_media');
  assert.equal(resDefault.isPermitted, true);
  assert.equal(resDefault.canExtractStreams, true);
  assert.equal(resDefault.policyCode, 'DIRECT_MEDIA_VERIFIED');

  // User-created content with affirmative attestation
  const declOwned: RightsDeclaration = {
    ownershipType: 'user_created_content',
    attestation: true,
  };
  const resOwned = RightsValidator.evaluate(testUrl, declOwned, 'direct_media');
  assert.equal(resOwned.isPermitted, true);
  assert.equal(resOwned.canExtractStreams, true);
  assert.equal(resOwned.policyCode, 'USER_OWNED_VERIFIED');
  assert.equal(resOwned.attributionRequired, false);

  // User-created content without attestation
  const declMissingAttestation: RightsDeclaration = {
    ownershipType: 'user_created_content',
    attestation: false,
  };
  const resMissing = RightsValidator.evaluate(testUrl, declMissingAttestation, 'direct_media');
  assert.equal(resMissing.isPermitted, false);
  assert.equal(resMissing.canExtractStreams, false);
  assert.equal(resMissing.policyCode, 'MISSING_ATTESTATION');
  assert.throws(() => RightsValidator.assertPermitted(resMissing), RightsViolationError);

  // Creative Commons declaration
  const declCC: RightsDeclaration = {
    ownershipType: 'creative_commons',
    attestation: true,
    licenseType: 'CC-BY-4.0',
  };
  const resCC = RightsValidator.evaluate(testUrl, declCC, 'direct_media');
  assert.equal(resCC.isPermitted, true);
  assert.equal(resCC.canExtractStreams, true);
  assert.equal(resCC.attributionRequired, true);
  assert.equal(resCC.policyCode, 'CREATIVE_COMMONS_VERIFIED');

  // Public domain declaration
  const declPD: RightsDeclaration = {
    ownershipType: 'public_domain',
    attestation: true,
  };
  const resPD = RightsValidator.evaluate(testUrl, declPD, 'direct_media');
  assert.equal(resPD.isPermitted, true);
  assert.equal(resPD.canExtractStreams, true);
  assert.equal(resPD.policyCode, 'PUBLIC_DOMAIN_VERIFIED');

  // Third party copyright declaration without authorized license
  const declThirdParty: RightsDeclaration = {
    ownershipType: 'third_party_copyright',
    attestation: false,
  };
  const resThirdParty = RightsValidator.evaluate(testUrl, declThirdParty, 'direct_media');
  assert.equal(resThirdParty.isPermitted, false);
  assert.equal(resThirdParty.canExtractStreams, false);
  assert.equal(resThirdParty.policyCode, 'UNAUTHORIZED_THIRD_PARTY_RESTRICTED');
}

// 3. YouTube Platform Policy Gate
{
  const ytUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  // YouTube without declaration
  const ytDefault = RightsValidator.evaluate(ytUrl, undefined, 'youtube_permitted');
  assert.equal(ytDefault.isPermitted, true);
  assert.equal(ytDefault.canExtractStreams, false, 'YouTube stream extraction must NEVER be permitted');
  assert.equal(ytDefault.canPreview, true);
  assert.equal(ytDefault.policyCode, 'PREVIEW_ONLY_PERMITTED');

  // YouTube with user ownership claim
  const ytOwned: RightsDeclaration = {
    ownershipType: 'user_created_content',
    attestation: true,
  };
  const ytOwnedRes = RightsValidator.evaluate(ytUrl, ytOwned, 'youtube_permitted');
  assert.equal(ytOwnedRes.isPermitted, true);
  assert.equal(ytOwnedRes.canPreview, true);
  assert.equal(ytOwnedRes.canExtractStreams, false, 'Even with user-owned claim, remote stream extraction is disabled pending platform agreement');

  // YouTube with third-party copyright declaration
  const ytThirdParty: RightsDeclaration = {
    ownershipType: 'third_party_copyright',
    attestation: false,
  };
  const ytThirdPartyRes = RightsValidator.evaluate(ytUrl, ytThirdParty, 'youtube_permitted');
  assert.equal(ytThirdPartyRes.isPermitted, false);
  assert.equal(ytThirdPartyRes.canExtractStreams, false);
  assert.equal(ytThirdPartyRes.canPreview, true); // safe embed preview is permitted
}

console.log('✓ Rights Validator & Abuse Detection Tests passed successfully');
