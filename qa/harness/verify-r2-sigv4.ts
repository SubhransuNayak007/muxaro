/**
 * Independent QA Verification of Cloudflare R2 Pure-Node AWS SigV4 StorageService
 * Owned by AGENT 10 (Independent QA, Performance & Release Engineer)
 */
import { StorageService } from '../../apps/api/src/services/storage.service.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

// 1. Default unconfigured instance must honestly report mode='local', configured=false
const localSvc = new StorageService({});
assert(localSvc.mode === 'local' && !localSvc.isR2Configured(), `Expected honest mode='local', got ${localSvc.mode}`);

// 2. Key generation & traversal rejection
const key = localSvc.generateObjectKey('processed', 'MXR-TESTUSER', '../../evil file (1).mp4');
assert(key.startsWith('processed/') && !key.includes('..') && key.endsWith('.mp4'), `Unsafe generated key: ${key}`);

let traversalRejected = 0;
for (const bad of ['../secret', 'uploads/../../etc/passwd', '/etc/passwd', 'uploads/a\\b']) {
  try {
    localSvc.assertSafeObjectKey(bad);
  } catch {
    traversalRejected++;
  }
}
assert(traversalRejected === 4, `Expected 4/4 traversal keys rejected, got ${traversalRejected}`);

// 3. MIME & file size validation
localSvc.validateUploadMetadata('video/mp4', 1024 * 1024);
let sizeBlocked = false;
try {
  localSvc.validateUploadMetadata('video/mp4', 10 * 1024 * 1024 * 1024);
} catch {
  sizeBlocked = true;
}
assert(sizeBlocked, 'Oversized upload (>2GB) was not rejected');

// 4. Configured R2 mode + AWS4-HMAC-SHA256 presigned GET URLs (attachment & inline)
const r2Svc = new StorageService({
  accountId: '0123456789abcdef0123456789abcdef',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  bucketName: 'muxaro-media-test',
});
assert(r2Svc.mode === 'r2' && r2Svc.isR2Configured(), 'Expected mode=r2 when all 4 env fields provided');

const attUrl = r2Svc.getPresignedDownloadUrl(key, {
  expiresInSeconds: 900,
  filename: 'Vacation Clip.mp4',
  inline: false,
});
assert(
  attUrl.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256') &&
    attUrl.includes('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE') &&
    attUrl.includes('X-Amz-Expires=900') &&
    attUrl.includes('X-Amz-Signature=') &&
    attUrl.includes('response-content-disposition=attachment'),
  `Invalid attachment presigned URL: ${attUrl}`
);

const inlUrl = r2Svc.getPresignedDownloadUrl(key, {
  expiresInSeconds: 300,
  filename: 'Vacation Clip.mp4',
  inline: true,
});
assert(
  inlUrl.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256') &&
    inlUrl.includes('response-content-disposition=inline'),
  `Invalid inline presigned URL: ${inlUrl}`
);

console.log('PASS R2 SigV4 Verification: honest local fallback, 4/4 traversal blocks, size guard, AWS4-HMAC-SHA256 attachment & inline presigned URLs verified.');
