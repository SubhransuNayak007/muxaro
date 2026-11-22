/**
 * MUXARO Media Processing Platform - S3 & Cloudflare R2 Client Factory
 * 
 * Configures the AWS SDK v3 S3Client for high-throughput zero-copy streaming,
 * multipart uploads, and lifecycle eviction against Cloudflare R2 / AWS S3 / MinIO.
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

let globalS3Client: S3Client | null = null;

export interface S3StorageConfig {
  readonly endpoint?: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucketName: string;
  readonly publicEndpoint?: string;
  readonly forcePathStyle: boolean;
}

/**
 * Resolves storage configuration from environment variables with graceful fallbacks
 */
export function getStorageConfig(): S3StorageConfig {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || 'minioadmin';
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin';
  const bucketName =
    process.env.R2_BUCKET_NAME || process.env.AWS_S3_BUCKET || 'muxaro-media';
  const region = process.env.R2_REGION || process.env.AWS_REGION || 'auto';

  // Endpoint resolution: custom R2_ENDPOINT -> R2 account endpoint -> MinIO local dev
  let endpoint = process.env.R2_ENDPOINT;
  let forcePathStyle = false;

  if (!endpoint && accountId) {
    endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  } else if (!endpoint && process.env.MINIO_ENDPOINT) {
    endpoint = process.env.MINIO_ENDPOINT;
    forcePathStyle = true;
  } else if (!endpoint && process.env.NODE_ENV !== 'production') {
    // Default local developer MinIO endpoint
    endpoint = 'http://127.0.0.1:9000';
    forcePathStyle = true;
  }

  const publicEndpoint =
    process.env.R2_PUBLIC_ENDPOINT ||
    (endpoint ? `${endpoint}/${bucketName}` : undefined);

  return {
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicEndpoint,
    forcePathStyle,
  };
}

/**
 * Returns a singleton S3Client instance
 */
export function getS3Client(): S3Client {
  if (!globalS3Client) {
    const config = getStorageConfig();
    globalS3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
      maxAttempts: 3,
    });
  }
  return globalS3Client;
}

/**
 * Returns the target storage bucket name
 */
export function getR2BucketName(): string {
  return getStorageConfig().bucketName;
}

/**
 * Constructs the canonical public or internal download URL for an artifact
 */
export function getPublicDownloadUrl(storageKey: string): string {
  const config = getStorageConfig();
  if (config.publicEndpoint) {
    return `${config.publicEndpoint.replace(/\/+$/, '')}/${storageKey.replace(/^\/+/, '')}`;
  }
  return `/${storageKey.replace(/^\/+/, '')}`;
}

/**
 * Fetches an object stream from S3 / R2 as a Node.js Readable stream
 */
export async function getObjectStream(storageKey: string): Promise<Readable> {
  const client = getS3Client();
  const bucket = getR2BucketName();

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    })
  );

  if (!response.Body) {
    throw new Error(`S3 GetObject returned empty body for key: "${storageKey}"`);
  }

  return response.Body as Readable;
}
