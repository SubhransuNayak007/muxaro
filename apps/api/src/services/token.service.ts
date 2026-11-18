/**
 * Project MUXARO - Secure Signed Download Token Service
 * Delivers tamper-proof, time-limited download authorization tokens
 */

import crypto from 'node:crypto';
import { config } from '../config.js';
import type { SignedDownloadTokenPayload } from '../types/index.js';

export class TokenService {
  private readonly secret: string;

  constructor(secret: string = config.signedTokenSecret) {
    this.secret = secret;
  }

  /**
   * Generates a tamper-proof HMAC-SHA256 signed download token string
   */
  public generateDownloadToken(
    params: {
      jobId: string;
      artifactId: string;
      filename: string;
      userId: string;
      ttlSeconds?: number;
    }
  ): string {
    const ttl = params.ttlSeconds ?? 3600; // default 1 hour expiration
    const payload: SignedDownloadTokenPayload = {
      jobId: params.jobId,
      artifactId: params.artifactId,
      filename: params.filename,
      userId: params.userId,
      expiresAt: Date.now() + ttl * 1000,
    };

    const payloadJson = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadJson).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(payloadB64)
      .digest('base64url');

    return `${payloadB64}.${signature}`;
  }

  /**
   * Verifies and extracts the payload from a signed download token.
   * Throws Error if signature is invalid or token has expired.
   */
  public verifyDownloadToken(token: string): SignedDownloadTokenPayload {
    if (!token || typeof token !== 'string') {
      throw new Error('Token is missing or not a string');
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new Error('Malformed download token format');
    }

    const [payloadB64, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(payloadB64)
      .digest('base64url');

    // Timing-safe signature comparison to mitigate timing attacks
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new Error('Invalid download token signature: token was tampered with');
    }

    let payload: SignedDownloadTokenPayload;
    try {
      const decodedJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
      payload = JSON.parse(decodedJson);
    } catch {
      throw new Error('Failed to parse download token payload');
    }

    if (Date.now() > payload.expiresAt) {
      throw new Error('Download token has expired');
    }

    return payload;
  }

  /**
   * Generates full public download URL for a given job and artifact
   */
  public getDownloadUrl(params: {
    jobId: string;
    artifactId: string;
    filename: string;
    userId: string;
    ttlSeconds?: number;
  }): string {
    const token = this.generateDownloadToken(params);
    return `${config.baseUrl}/api/v1/download/${token}`;
  }
}

export const tokenService = new TokenService();
