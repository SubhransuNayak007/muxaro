/**
 * Project MUXARO - S3-Compatible Cloudflare R2 Storage Service (Pure Node AWS SigV4)
 *
 * Zero external SDK dependencies — uses Node's built-in `node:crypto` + `fetch`:
 * - Logical prefixes: `uploads/`, `processed/`, `playlists/`, `temporary/`
 * - Non-guessable sanitized server-generated object keys (path-traversal proof)
 * - Real AWS Signature Version 4 (`AWS4-HMAC-SHA256`) header & query-string presigning
 * - S3 REST API operations: putObject, headObject, deleteObject, multipart upload helpers
 * - Content-type & size guardrails, SHA-256 checksum tagging (`x-amz-meta-sha256`), lifecycle cleanup
 * - Honest mode selection: `mode: 'r2'` ONLY when all 4 R2 env vars are configured; else `mode: 'local'`
 */

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { sanitizeFilename } from '@vyro/security';
import { config, type R2StorageConfig } from '../config.js';

export type StoragePrefix = 'uploads' | 'processed' | 'playlists' | 'temporary';
export type StorageMode = 'r2' | 'local';

const ALLOWED_PREFIXES = new Set<StoragePrefix>(['uploads', 'processed', 'playlists', 'temporary']);
const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const ALLOWED_MIME_PREFIXES = ['video/', 'audio/', 'application/octet-stream', 'application/zip'];

export interface PresignedDownloadOptions {
  expiresInSeconds?: number;
  filename?: string;
  inline?: boolean;
  now?: Date;
}

export interface PutObjectOptions {
  contentType: string;
  sha256?: string;
  maxBytes?: number;
  metadata?: Record<string, string>;
}

export interface HeadObjectResult {
  exists: boolean;
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  sha256?: string;
}

/**
 * RFC 3986 URI encoding required by AWS SigV4 canonicalization.
 */
export function awsUriEncode(input: string, encodeSlash: boolean = true): string {
  return encodeURIComponent(input)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, encodeSlash ? '%2F' : '/');
}

function sha256Hex(data: Buffer | Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function formatAmzDates(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso, // YYYYMMDDTHHMMSSZ
    dateStamp: iso.slice(0, 8), // YYYYMMDD
  };
}

function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string = 's3'
): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

export class StorageService {
  private readonly r2: R2StorageConfig;
  public readonly mode: StorageMode;

  constructor(r2Override?: Partial<R2StorageConfig>) {
    const accountId = (r2Override?.accountId ?? config.r2.accountId).trim();
    const accessKeyId = (r2Override?.accessKeyId ?? config.r2.accessKeyId).trim();
    const secretAccessKey = (r2Override?.secretAccessKey ?? config.r2.secretAccessKey).trim();
    const bucketName = (r2Override?.bucketName ?? config.r2.bucketName).trim();
    const region = (r2Override?.region ?? config.r2.region ?? 'auto').trim() || 'auto';
    const configured = Boolean(accountId && accessKeyId && secretAccessKey && bucketName);
    const endpoint =
      (r2Override?.endpoint ?? config.r2.endpoint).trim().replace(/\/+$/, '') ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');

    this.r2 = {
      accountId,
      accessKeyId,
      secretAccessKey,
      bucketName,
      endpoint,
      publicEndpoint: (r2Override?.publicEndpoint ?? config.r2.publicEndpoint)?.trim().replace(/\/+$/, ''),
      region,
      configured,
    };
    this.mode = configured ? 'r2' : 'local';
  }

  public isR2Configured(): boolean {
    return this.r2.configured;
  }

  public getStatus() {
    return {
      mode: this.mode,
      r2Configured: this.r2.configured,
      bucket: this.r2.configured ? this.r2.bucketName : null,
      region: this.r2.configured ? this.r2.region : null,
    };
  }

  /**
   * Generates a non-guessable, path-traversal-proof object key inside an allowed logical prefix:
   * `<prefix>/<YYYYMMDD>/<ownerHash12>/<randomHex16>_<safeFilename>`
   */
  public generateObjectKey(prefix: StoragePrefix, ownerId: string, filename: string): string {
    if (!ALLOWED_PREFIXES.has(prefix)) {
      throw new Error(`Unsupported storage prefix: ${prefix}`);
    }
    const cleanName = sanitizeFilename(filename, 'media.bin').replace(/^_+/, '') || 'media.bin';
    const ownerHash = crypto
      .createHash('sha256')
      .update(ownerId || 'anon')
      .digest('hex')
      .slice(0, 12);
    const nonce = crypto.randomBytes(12).toString('hex');
    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const key = `${prefix}/${dateStamp}/${ownerHash}/${nonce}_${cleanName}`;
    this.assertSafeObjectKey(key);
    return key;
  }

  /**
   * Rejects any object key containing traversal, null bytes, leading slashes, or unknown prefixes.
   */
  public assertSafeObjectKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new Error('Object key must be a non-empty string');
    }
    if (key.includes('\0') || key.includes('..') || key.includes('\\') || key.startsWith('/')) {
      throw new Error(`Unsafe object key rejected: ${key}`);
    }
    const firstSegment = key.split('/')[0] as StoragePrefix;
    if (!ALLOWED_PREFIXES.has(firstSegment)) {
      throw new Error(`Object key must reside under allowed prefixes: ${Array.from(ALLOWED_PREFIXES).join(', ')}`);
    }
  }

  /**
   * Validates content type and byte size before uploading to R2 or local storage.
   */
  public validateUploadMetadata(
    contentType: string,
    sizeBytes: number,
    maxBytes: number = DEFAULT_MAX_UPLOAD_BYTES
  ): void {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new Error('Upload size must be greater than 0 bytes');
    }
    if (sizeBytes > maxBytes) {
      throw new Error(`File size ${sizeBytes} exceeds maximum allowed ${maxBytes} bytes`);
    }
    const normalizedType = (contentType || '').toLowerCase().split(';')[0].trim();
    const allowed = ALLOWED_MIME_PREFIXES.some((prefix) =>
      prefix.endsWith('/') ? normalizedType.startsWith(prefix) : normalizedType === prefix
    );
    if (!allowed) {
      throw new Error(`Unsupported media content-type: ${contentType}`);
    }
  }

  private assertR2Enabled(): void {
    if (!this.r2.configured || !this.r2.endpoint) {
      throw new Error(
        'Cloudflare R2 is not configured (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)'
      );
    }
  }

  private buildObjectUrl(key: string): URL {
    this.assertR2Enabled();
    this.assertSafeObjectKey(key);
    const encodedPath = `/${awsUriEncode(this.r2.bucketName)}/${awsUriEncode(key, false)}`;
    return new URL(`${this.r2.endpoint}${encodedPath}`);
  }

  /**
   * Signs an S3 HTTP request using AWS Signature Version 4 (`AWS4-HMAC-SHA256`).
   */
  public signRequest(params: {
    method: string;
    url: URL;
    headers?: Record<string, string>;
    payloadHash?: string;
    now?: Date;
  }): Record<string, string> {
    this.assertR2Enabled();
    const now = params.now ?? new Date();
    const { amzDate, dateStamp } = formatAmzDates(now);
    const payloadHash = params.payloadHash || 'UNSIGNED-PAYLOAD';

    const headerMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(params.headers || {})) {
      headerMap[k.toLowerCase().trim()] = v.trim();
    }
    headerMap['host'] = params.url.host;
    headerMap['x-amz-date'] = amzDate;
    headerMap['x-amz-content-sha256'] = payloadHash;

    const sortedHeaderNames = Object.keys(headerMap).sort();
    const canonicalHeaders = sortedHeaderNames.map((k) => `${k}:${headerMap[k]}\n`).join('');
    const signedHeaders = sortedHeaderNames.join(';');

    const queryPairs: Array<[string, string]> = [];
    params.url.searchParams.forEach((value, key) => {
      queryPairs.push([awsUriEncode(key), awsUriEncode(value)]);
    });
    queryPairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
    const canonicalQueryString = queryPairs.map(([k, v]) => `${k}=${v}`).join('&');

    const canonicalRequest = [
      params.method.toUpperCase(),
      params.url.pathname,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.r2.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = deriveSigningKey(this.r2.secretAccessKey, dateStamp, this.r2.region, 's3');
    const signature = crypto
      .createHmac('sha256', signingKey)
      .update(stringToSign, 'utf8')
      .digest('hex');

    headerMap['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.r2.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return headerMap;
  }

  /**
   * Generates a real AWS SigV4 query-string presigned GET URL for direct R2 download or inline preview.
   */
  public getPresignedDownloadUrl(key: string, options: PresignedDownloadOptions = {}): string {
    this.assertR2Enabled();
    const url = this.buildObjectUrl(key);
    const now = options.now ?? new Date();
    const { amzDate, dateStamp } = formatAmzDates(now);
    const expiresIn = Math.max(60, Math.min(86400, Math.floor(options.expiresInSeconds ?? 3600)));
    const credentialScope = `${dateStamp}/${this.r2.region}/s3/aws4_request`;

    const queryEntries: Array<[string, string]> = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${this.r2.accessKeyId}/${credentialScope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(expiresIn)],
      ['X-Amz-SignedHeaders', 'host'],
    ];

    if (options.filename) {
      const safeName = sanitizeFilename(options.filename, 'download.mp4');
      const disp = options.inline ? 'inline' : 'attachment';
      queryEntries.push(['response-content-disposition', `${disp}; filename="${safeName}"`]);
    }

    const encodedPairs = queryEntries
      .map(([k, v]) => [awsUriEncode(k), awsUriEncode(v)] as [string, string])
      .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

    const canonicalQueryString = encodedPairs.map(([k, v]) => `${k}=${v}`).join('&');
    const canonicalHeaders = `host:${url.host}\n`;
    const canonicalRequest = [
      'GET',
      url.pathname,
      canonicalQueryString,
      canonicalHeaders,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = deriveSigningKey(this.r2.secretAccessKey, dateStamp, this.r2.region, 's3');
    const signature = crypto
      .createHmac('sha256', signingKey)
      .update(stringToSign, 'utf8')
      .digest('hex');

    return `${url.origin}${url.pathname}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  }

  /**
   * Uploads an object to Cloudflare R2 with SHA-256 checksum tagging (`x-amz-meta-sha256`).
   */
  public async putObject(
    key: string,
    body: Buffer | Uint8Array,
    options: PutObjectOptions
  ): Promise<{ key: string; etag?: string; sha256: string; sizeBytes: number }> {
    this.assertR2Enabled();
    this.validateUploadMetadata(options.contentType, body.byteLength, options.maxBytes);
    const url = this.buildObjectUrl(key);
    const computedSha = options.sha256 || sha256Hex(body);

    const headers: Record<string, string> = {
      'content-type': options.contentType,
      'content-length': String(body.byteLength),
      'x-amz-meta-sha256': computedSha,
    };
    if (options.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        const safeMetaKey = k.toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (safeMetaKey) headers[`x-amz-meta-${safeMetaKey}`] = v;
      }
    }

    const signedHeaders = this.signRequest({
      method: 'PUT',
      url,
      headers,
      payloadHash: computedSha,
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers: signedHeaders,
      body: Buffer.from(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`R2 putObject failed (HTTP ${response.status}): ${errText.slice(0, 200)}`);
    }

    return {
      key,
      etag: response.headers.get('etag') || undefined,
      sha256: computedSha,
      sizeBytes: body.byteLength,
    };
  }

  /**
   * Checks existence and metadata of an R2 object.
   */
  public async headObject(key: string): Promise<HeadObjectResult> {
    this.assertR2Enabled();
    const url = this.buildObjectUrl(key);
    const signedHeaders = this.signRequest({
      method: 'HEAD',
      url,
      payloadHash: sha256Hex(''),
    });

    const response = await fetch(url, { method: 'HEAD', headers: signedHeaders });
    if (response.status === 404) {
      return { exists: false };
    }
    if (!response.ok) {
      throw new Error(`R2 headObject failed (HTTP ${response.status})`);
    }
    const len = response.headers.get('content-length');
    return {
      exists: true,
      contentLength: len ? Number(len) : undefined,
      contentType: response.headers.get('content-type') || undefined,
      etag: response.headers.get('etag') || undefined,
      lastModified: response.headers.get('last-modified') || undefined,
      sha256: response.headers.get('x-amz-meta-sha256') || undefined,
    };
  }

  /**
   * Deletes an object from R2.
   */
  public async deleteObject(key: string): Promise<void> {
    this.assertR2Enabled();
    const url = this.buildObjectUrl(key);
    const signedHeaders = this.signRequest({
      method: 'DELETE',
      url,
      payloadHash: sha256Hex(''),
    });

    const response = await fetch(url, { method: 'DELETE', headers: signedHeaders });
    if (!response.ok && response.status !== 404) {
      const errText = await response.text().catch(() => '');
      throw new Error(`R2 deleteObject failed (HTTP ${response.status}): ${errText.slice(0, 200)}`);
    }
  }

  /**
   * Initiates an S3 multipart upload on R2.
   */
  public async createMultipartUpload(
    key: string,
    contentType: string,
    sha256?: string
  ): Promise<{ uploadId: string; key: string }> {
    this.assertR2Enabled();
    const url = this.buildObjectUrl(key);
    url.searchParams.set('uploads', '');
    const headers: Record<string, string> = { 'content-type': contentType };
    if (sha256) headers['x-amz-meta-sha256'] = sha256;

    const signedHeaders = this.signRequest({
      method: 'POST',
      url,
      headers,
      payloadHash: sha256Hex(''),
    });

    const response = await fetch(url, { method: 'POST', headers: signedHeaders });
    const xml = await response.text();
    if (!response.ok) {
      throw new Error(`R2 createMultipartUpload failed (HTTP ${response.status}): ${xml.slice(0, 200)}`);
    }
    const match = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
    if (!match) {
      throw new Error('R2 createMultipartUpload response missing <UploadId>');
    }
    return { uploadId: match[1], key };
  }

  /**
   * Uploads a single part in an R2 multipart upload.
   */
  public async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    chunk: Buffer | Uint8Array
  ): Promise<{ partNumber: number; etag: string }> {
    this.assertR2Enabled();
    const url = this.buildObjectUrl(key);
    url.searchParams.set('partNumber', String(partNumber));
    url.searchParams.set('uploadId', uploadId);

    const payloadHash = sha256Hex(chunk);
    const signedHeaders = this.signRequest({
      method: 'PUT',
      url,
      headers: { 'content-length': String(chunk.byteLength) },
      payloadHash,
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers: signedHeaders,
      body: Buffer.from(chunk),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`R2 uploadPart ${partNumber} failed (HTTP ${response.status}): ${errText.slice(0, 200)}`);
    }
    const etag = response.headers.get('etag') || '';
    return { partNumber, etag };
  }

  /**
   * Completes an R2 multipart upload from ordered `{ partNumber, etag }` entries.
   */
  public async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<{ key: string; etag?: string }> {
    this.assertR2Enabled();
    const url = this.buildObjectUrl(key);
    url.searchParams.set('uploadId', uploadId);

    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const xmlBody =
      `<CompleteMultipartUpload>` +
      ordered.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('') +
      `</CompleteMultipartUpload>`;
    const payloadHash = sha256Hex(xmlBody);

    const signedHeaders = this.signRequest({
      method: 'POST',
      url,
      headers: {
        'content-type': 'application/xml',
        'content-length': String(Buffer.byteLength(xmlBody)),
      },
      payloadHash,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: signedHeaders,
      body: xmlBody,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`R2 completeMultipartUpload failed (HTTP ${response.status}): ${text.slice(0, 200)}`);
    }
    const etagMatch = text.match(/<ETag>([^<]+)<\/ETag>/);
    return { key, etag: etagMatch?.[1] };
  }

  /**
   * Aborts an incomplete R2 multipart upload to avoid orphaned part storage charges.
   */
  public async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    this.assertR2Enabled();
    const url = this.buildObjectUrl(key);
    url.searchParams.set('uploadId', uploadId);
    const signedHeaders = this.signRequest({
      method: 'DELETE',
      url,
      payloadHash: sha256Hex(''),
    });

    const response = await fetch(url, { method: 'DELETE', headers: signedHeaders });
    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => '');
      throw new Error(`R2 abortMultipartUpload failed (HTTP ${response.status}): ${text.slice(0, 200)}`);
    }
  }

  /**
   * Lifecycle deletion helper: sweeps expired objects in R2 (via ListObjectsV2) or local scratch directories.
   */
  public async deleteExpiredObjects(
    prefix: StoragePrefix,
    maxAgeMs: number = 24 * 60 * 60 * 1000
  ): Promise<{ mode: StorageMode; deletedCount: number }> {
    if (!ALLOWED_PREFIXES.has(prefix)) {
      throw new Error(`Invalid storage prefix: ${prefix}`);
    }

    const cutoffMs = Date.now() - maxAgeMs;

    if (this.mode === 'local') {
      const rootDir =
        prefix === 'uploads'
          ? path.resolve(process.cwd(), '.muxaro-uploads')
          : path.resolve(process.cwd(), '.muxaro-artifacts');
      let deletedCount = 0;
      const entries = await fsp.readdir(rootDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);
        const stat = await fsp.stat(fullPath).catch(() => null);
        if (stat && stat.mtimeMs < cutoffMs) {
          await fsp.rm(fullPath, { recursive: true, force: true }).catch(() => {});
          deletedCount++;
        }
      }
      return { mode: 'local', deletedCount };
    }

    // R2 mode: ListObjectsV2 under prefix/ and delete expired objects
    this.assertR2Enabled();
    const listUrl = new URL(`${this.r2.endpoint}/${awsUriEncode(this.r2.bucketName)}`);
    listUrl.searchParams.set('list-type', '2');
    listUrl.searchParams.set('prefix', `${prefix}/`);

    const signedHeaders = this.signRequest({
      method: 'GET',
      url: listUrl,
      payloadHash: sha256Hex(''),
    });
    const res = await fetch(listUrl, { method: 'GET', headers: signedHeaders });
    if (!res.ok) {
      throw new Error(`R2 listObjectsV2 failed (HTTP ${res.status})`);
    }
    const xml = await res.text();
    const itemMatches = xml.matchAll(
      /<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<LastModified>([^<]+)<\/LastModified>[\s\S]*?<\/Contents>/g
    );

    let deletedCount = 0;
    for (const m of itemMatches) {
      const key = m[1];
      const lastModMs = Date.parse(m[2]);
      if (!Number.isNaN(lastModMs) && lastModMs < cutoffMs) {
        await this.deleteObject(key);
        deletedCount++;
      }
    }
    return { mode: 'r2', deletedCount };
  }
}

export const storageService = new StorageService();
