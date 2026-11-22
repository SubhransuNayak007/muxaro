/**
 * MUXARO Media Processing Platform - Zero-Credential Scoped Worker Ticket Minter
 *
 * Implements the Zero-Credential Worker pattern:
 * Workers never receive long-lived AWS / R2 master storage credentials.
 * Instead, they are minted fine-grained, single-object scoped presigned URLs
 * with tight time-to-live bounds and HMAC-signed job progress webhook callbacks.
 */

import type { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import { config } from '../config.js';

export interface MintScopedWorkerTicketParams {
  jobId: string;
  inputKey?: string;
  outputKey: string;
  contentType: string;
  retention: '60m' | '24h';
}

export interface ScopedWorkerTicket {
  jobId: string;
  inputGetUrl?: string;
  inputUrl?: string;
  outputPutUrl: string;
  outputUrl: string;
  progressWebhookUrl: string;
  progressToken: string;
  retention: '60m' | '24h';
  expiresAt: string;
  getTtlSeconds?: number;
  putTtlSeconds: number;
}

/** Single-object presigned GET TTL: 15 minutes (900 seconds) */
export const SCOPED_GET_TTL_SECONDS = 15 * 60;

/** Single-object presigned PUT TTL: 30 minutes (1800 seconds) */
export const SCOPED_PUT_TTL_SECONDS = 30 * 60;

/**
 * Computes a tamper-proof HMAC-SHA256 progress token scoped exclusively to the given jobId.
 */
export function generateProgressToken(jobId: string, secret?: string): string {
  const hmacSecret =
    secret ||
    process.env.WORKER_HMAC_SECRET ||
    process.env.PROGRESS_TOKEN_SECRET ||
    config.signedTokenSecret ||
    'muxaro-worker-progress-hmac-secret-default-key-32';
  return crypto.createHmac('sha256', hmacSecret).update(`progress:${jobId}`).digest('hex');
}

/**
 * Verifies an incoming HMAC progress token against the specific jobId using timing-safe comparison.
 */
export function verifyProgressToken(jobId: string, token: string, secret?: string): boolean {
  if (!jobId || !token || typeof token !== 'string') return false;
  const expected = generateProgressToken(jobId, secret);
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  if (tokenBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(tokenBuf, expectedBuf);
}

/**
 * Issues zero-credential scoped presigned URLs for single-object worker execution:
 * - Single-object GET (15m TTL) if inputKey is specified
 * - Single-object PUT (30m TTL) for output artifact key
 * - Progress webhook URL with HMAC progress token signed for that specific jobId
 */
export async function mintScopedWorkerTicket(
  s3: S3Client,
  bucket: string,
  params: MintScopedWorkerTicketParams
): Promise<ScopedWorkerTicket> {
  if (!params.jobId) {
    throw new Error('jobId is required to mint scoped worker ticket');
  }
  if (!params.outputKey) {
    throw new Error('outputKey is required to mint scoped worker ticket');
  }

  let inputGetUrl: string | undefined;

  // 1. Issue single-object scoped presigned GET (15m TTL)
  if (params.inputKey) {
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: params.inputKey,
    });
    inputGetUrl = await getSignedUrl(s3, getCommand, { expiresIn: SCOPED_GET_TTL_SECONDS });
  }

  // 2. Issue single-object scoped presigned PUT (30m TTL)
  const putCommand = new PutObjectCommand({
    Bucket: bucket,
    Key: params.outputKey,
    ContentType: params.contentType,
  });
  const outputPutUrl = await getSignedUrl(s3, putCommand, { expiresIn: SCOPED_PUT_TTL_SECONDS });

  // 3. Issue HMAC progress token and progressWebhookUrl
  const progressToken = generateProgressToken(params.jobId);
  const apiBase = (
    config.apiBaseUrl ||
    process.env.API_BASE_URL ||
    process.env.BASE_URL ||
    'http://localhost:4000'
  ).replace(/\/+$/, '');
  const progressWebhookUrl = `${apiBase}/v1/jobs/${params.jobId}/progress?token=${progressToken}`;

  const expiresAt = new Date(Date.now() + SCOPED_PUT_TTL_SECONDS * 1000).toISOString();

  return {
    jobId: params.jobId,
    inputGetUrl,
    inputUrl: inputGetUrl,
    outputPutUrl,
    outputUrl: outputPutUrl,
    progressWebhookUrl,
    progressToken,
    retention: params.retention,
    expiresAt,
    getTtlSeconds: params.inputKey ? SCOPED_GET_TTL_SECONDS : undefined,
    putTtlSeconds: SCOPED_PUT_TTL_SECONDS,
  };
}
