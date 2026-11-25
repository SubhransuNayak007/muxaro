import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { classifyApiError, createApiErrorResponse } from '../lib/api-error';
import { POST as handleProbePost, GET as handleProbeGet } from '../app/api/v1/probe/route';
import { POST as handleJobsPost } from '../app/api/v1/jobs/route';
import { GET as handleDownloadGet } from '../app/api/v1/jobs/[id]/download/route';
import { POST as handleRetryPost } from '../app/api/v1/jobs/[id]/retry/route';
import { POST as handleAnalyzePost, GET as handleAnalyzeGet } from '../app/api/v1/analyze/route';
import { jobManager } from '../lib/job-manager';

describe('Phase 0 API Error Normalization & Proxy Cleanup', () => {
  describe('classifyApiError', () => {
    it('classifies YouTube bot guard and 403 as HOST_BLOCKED with status 403', () => {
      const err1 = classifyApiError('Sign in to confirm you’re not a bot. This helps protect our community.');
      assert.strictEqual(err1.code, 'HOST_BLOCKED');
      assert.strictEqual(err1.status, 403);

      const err2 = classifyApiError('HTTP Error 403: Forbidden');
      assert.strictEqual(err2.code, 'HOST_BLOCKED');
      assert.strictEqual(err2.status, 403);

      const err3 = classifyApiError('Rate limited: 429 Too Many Requests');
      assert.strictEqual(err3.code, 'HOST_BLOCKED');
      assert.strictEqual(err3.status, 403);
    });

    it('classifies invalid, empty, or SSRF-blocked URLs as INVALID_URL', () => {
      const err1 = classifyApiError('URL query parameter is required.');
      assert.strictEqual(err1.code, 'INVALID_URL');
      assert.strictEqual(err1.status, 400);

      const err2 = classifyApiError('Access to internal or restricted host is prohibited.');
      assert.strictEqual(err2.code, 'INVALID_URL');
      assert.strictEqual(err2.status, 403);

      const err3 = classifyApiError('Malformed URL.');
      assert.strictEqual(err3.code, 'INVALID_URL');
      assert.strictEqual(err3.status, 400);
    });

    it('classifies timeouts and aborted requests as TIMEOUT with status 504', () => {
      const err1 = classifyApiError('yt-dlp execution timed out');
      assert.strictEqual(err1.code, 'TIMEOUT');
      assert.strictEqual(err1.status, 504);

      const err2 = classifyApiError(new DOMException('The operation was aborted', 'AbortError'));
      assert.strictEqual(err2.code, 'TIMEOUT');
      assert.strictEqual(err2.status, 504);
    });

    it('classifies missing backend/binaries honestly as 503 ERR_BACKEND_NOT_CONFIGURED instead of fake HOST_BLOCKED', () => {
      const err1 = classifyApiError('spawn yt-dlp ENOENT');
      assert.strictEqual(err1.code, 'ERR_BACKEND_NOT_CONFIGURED');
      assert.strictEqual(err1.status, 503);

      const err2 = classifyApiError('Unknown extraction failure');
      assert.strictEqual(err2.code, 'ERR_EXTRACTION_FAILED');
      assert.strictEqual(err2.status, 502);
    });
  });

  describe('createApiErrorResponse', () => {
    it('generates clean structured JSON with matching HTTP status', async () => {
      const res = createApiErrorResponse('Sign in to confirm you’re not a bot', 'HOST_BLOCKED');
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'HOST_BLOCKED');
      assert.strictEqual(data.status, 403);
      assert.ok(data.rawMessage.includes('bot'));
    });
  });

  describe('Probe Endpoint Standardized Errors', () => {
    it('returns 400 INVALID_URL on empty POST body', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await handleProbePost(req);
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'INVALID_URL');
      assert.strictEqual(data.status, 400);
    });

    it('returns 403 INVALID_URL on SSRF blocked URL in POST', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1:8080/internal' }),
      });
      const res = await handleProbePost(req);
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'INVALID_URL');
      assert.strictEqual(data.status, 403);
    });

    it('returns 400 INVALID_URL on GET without url parameter', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/probe');
      const res = await handleProbeGet(req);
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'INVALID_URL');
      assert.strictEqual(data.status, 400);
    });
  });

  describe('Analyze Endpoint Standardized Errors', () => {
    it('returns 400 INVALID_URL on empty POST body to /analyze', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await handleAnalyzePost(req);
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'INVALID_URL');
    });

    it('returns 400 INVALID_URL on GET to /analyze without url query', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/analyze');
      const res = await handleAnalyzeGet(req);
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'INVALID_URL');
    });
  });

  describe('Jobs Endpoint Standardized Errors', () => {
    it('returns 400 INVALID_URL on missing sourceUrl', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await handleJobsPost(req);
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'INVALID_URL');
      assert.strictEqual(data.status, 400);
    });

    it('returns 403 INVALID_URL on SSRF sourceUrl', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl: 'http://169.254.169.254/latest/meta-data' }),
      });
      const res = await handleJobsPost(req);
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'INVALID_URL');
      assert.strictEqual(data.status, 403);
    });
  });

  describe('Download Endpoint Standardized Errors', () => {
    it('returns 403 HOST_BLOCKED when a job failed due to bot check', async () => {
      const blockedJobId = `job_test_blocked_${Date.now()}`;
      (jobManager as any).jobs.set(blockedJobId, {
        id: blockedJobId,
        status: 'failed',
        progress: 0,
        stage: 'FAILED',
        stageMessage: 'YouTube requires session verification on cloud servers (BotGuard check).',
        sourceUrl: 'https://www.youtube.com/watch?v=blocked',
        targetFormat: 'mp4',
        operation: 'TRANSCODE_VIDEO',
        title: 'Blocked Video',
        filename: 'blocked.mp4',
        downloadUrl: `/api/v1/jobs/${blockedJobId}/download`,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        error: {
          code: 'ERR_YOUTUBE_BOT_CHECK',
          message: 'YouTube requires session verification on cloud servers (BotGuard check).',
          retryable: false,
        },
      });

      const req = new NextRequest(`http://localhost:3000/api/v1/jobs/${blockedJobId}/download`);
      const res = await handleDownloadGet(req, { params: { id: blockedJobId } });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'HOST_BLOCKED');
      assert.strictEqual(data.status, 403);
      assert.ok(data.rawMessage.includes('BotGuard') || data.rawMessage.includes('bot check'));
    });

    it('returns 403 INVALID_URL for forbidden/SSRF stream parameter', async () => {
      const nonExistentJob = `job_test_${Date.now()}`;
      const req = new NextRequest(
        `http://localhost:3000/api/v1/jobs/${nonExistentJob}/download?stream=http://127.0.0.1:8080/secret.mp4`
      );
      const res = await handleDownloadGet(req, { params: { id: nonExistentJob } });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'INVALID_URL');
      assert.strictEqual(data.status, 403);
    });

    it('returns 404 INVALID_URL when artifact does not exist', async () => {
      const missingJobId = `job_nonexistent_${Date.now()}`;
      const req = new NextRequest(`http://localhost:3000/api/v1/jobs/${missingJobId}/download`);
      const res = await handleDownloadGet(req, { params: { id: missingJobId } });
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'INVALID_URL');
      assert.strictEqual(data.status, 404);
    });
  });

  describe('Retry Endpoint Proxy Disablement', () => {
    it('rejects fake proxy retries for bot-blocked job with 403 HOST_BLOCKED', async () => {
      const blockedJobId = `job_retry_blocked_${Date.now()}`;
      (jobManager as any).jobs.set(blockedJobId, {
        id: blockedJobId,
        status: 'failed',
        progress: 0,
        stage: 'FAILED',
        stageMessage: 'BotGuard check',
        sourceUrl: 'https://www.youtube.com/watch?v=blocked',
        targetFormat: 'mp4',
        operation: 'TRANSCODE_VIDEO',
        title: 'Blocked Video',
        filename: 'blocked.mp4',
        downloadUrl: `/api/v1/jobs/${blockedJobId}/download`,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        error: {
          code: 'HOST_BLOCKED',
          message: 'Host blocked request (bot check / HTTP 403).',
          retryable: false,
        },
      });

      const req = new NextRequest(`http://localhost:3000/api/v1/jobs/${blockedJobId}/retry`, {
        method: 'POST',
      });
      const res = await handleRetryPost(req, { params: { id: blockedJobId } });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.code, 'HOST_BLOCKED');
      assert.strictEqual(data.status, 403);
    });
  });
});
