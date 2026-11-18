/**
 * Project MUXARO - API Server Configuration
 * Tagline: "Your Media. One Powerful Workspace."
 */

export interface R2StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
  publicEndpoint?: string;
  region: string;
  configured: boolean;
}

export interface ApiConfig {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  baseUrl: string;
  apiBaseUrl: string;
  siteUrl: string;
  databaseUrl?: string;
  redisUrl?: string;
  sessionSecret: string;
  signedTokenSecret: string;
  corsOrigin: string | string[] | boolean;
  maxPayloadBytes: number;
  rateLimitEnabled: boolean;
  workerConcurrency: number;
  ephemeralStorageDir: string;
  storageMode: 'r2' | 'local';
  r2: R2StorageConfig;
}

const DEFAULT_DEV_SESSION_SECRET =
  'muxaro-secret-dev-session-key-change-in-production-12345678';
const DEFAULT_DEV_TOKEN_SECRET =
  'muxaro-download-hmac-sha256-signing-token-secret-xyz';

const rawEnv = (process.env.NODE_ENV as ApiConfig['env']) || 'development';
const isProd = rawEnv === 'production';
const port = parseInt(process.env.PORT || '4000', 10);

const r2AccountId = (process.env.R2_ACCOUNT_ID || '').trim();
const r2AccessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
const r2SecretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const r2BucketName = (process.env.R2_BUCKET_NAME || '').trim();
const r2Configured = Boolean(
  r2AccountId && r2AccessKeyId && r2SecretAccessKey && r2BucketName
);
const r2Endpoint =
  (process.env.R2_ENDPOINT || '').trim() ||
  (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '');
const r2PublicEndpoint = (process.env.R2_PUBLIC_ENDPOINT || '').trim() || undefined;

const apiBaseUrl =
  (process.env.API_BASE_URL || process.env.BASE_URL || '').trim().replace(/\/+$/, '') ||
  (isProd ? 'https://api.muxaro.app' : `http://localhost:${port}`);

const siteUrl =
  (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '') ||
  (isProd ? 'https://muxaro.app' : 'http://localhost:3000');

export const config: ApiConfig = {
  env: rawEnv,
  port,
  host: process.env.HOST || '0.0.0.0',
  baseUrl: apiBaseUrl,
  apiBaseUrl,
  siteUrl,
  databaseUrl: (process.env.DATABASE_URL || '').trim() || undefined,
  redisUrl: (process.env.REDIS_URL || '').trim() || undefined,
  sessionSecret: process.env.SESSION_SECRET || DEFAULT_DEV_SESSION_SECRET,
  signedTokenSecret: process.env.SIGNED_TOKEN_SECRET || DEFAULT_DEV_TOKEN_SECRET,
  corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : true,
  maxPayloadBytes: parseInt(process.env.MAX_PAYLOAD_BYTES || '10485760', 10), // 10MB JSON
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '4', 10),
  ephemeralStorageDir: process.env.STORAGE_DIR || './storage/scratch',
  storageMode: r2Configured ? 'r2' : 'local',
  r2: {
    accountId: r2AccountId,
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
    bucketName: r2BucketName,
    endpoint: r2Endpoint,
    publicEndpoint: r2PublicEndpoint,
    region: (process.env.R2_REGION || 'auto').trim(),
    configured: r2Configured,
  },
};

export interface ProductionConfigValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Fail-safe production configuration validator.
 * Checks secrets, origins, and partial storage configuration without ever printing secret values.
 */
export function validateProductionConfig(cfg: ApiConfig = config): ProductionConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const anyR2VarSet = Boolean(
    cfg.r2.accountId || cfg.r2.accessKeyId || cfg.r2.secretAccessKey || cfg.r2.bucketName
  );
  if (anyR2VarSet && !cfg.r2.configured) {
    warnings.push(
      'Partial Cloudflare R2 configuration detected; falling back to local ephemeral storage until all 4 R2_* variables are set.'
    );
  }

  if (cfg.env === 'production') {
    if (cfg.sessionSecret === DEFAULT_DEV_SESSION_SECRET || cfg.sessionSecret.length < 32) {
      errors.push('SESSION_SECRET must be set to a cryptographically random 32+ character string in production.');
    }
    if (cfg.signedTokenSecret === DEFAULT_DEV_TOKEN_SECRET || cfg.signedTokenSecret.length < 32) {
      errors.push('SIGNED_TOKEN_SECRET must be set to a cryptographically random 32+ character string in production.');
    }
    if (cfg.apiBaseUrl.includes('localhost') || cfg.siteUrl.includes('localhost')) {
      errors.push('Production API_BASE_URL and SITE_URL must not reference localhost.');
    }
    if (cfg.corsOrigin === true || (Array.isArray(cfg.corsOrigin) && cfg.corsOrigin.includes('*'))) {
      warnings.push('CORS_ORIGIN should be restricted to explicit production origins (e.g. https://muxaro.app).');
    }
    if (!cfg.r2.configured) {
      warnings.push('Cloudflare R2 is not configured; using ephemeral local container disk storage.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
