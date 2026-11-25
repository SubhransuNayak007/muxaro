'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  Film,
  Plus,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { api, getApiBaseUrl, readCsrfTokenFromCookie } from '@/lib/api-client';
import { ProcessingJob } from '@/lib/types';
import { normalizeMediaUrl } from '@/lib/url-utils';
import ActiveLinkIndicator from '@/components/ActiveLinkIndicator';

const JobProgress = dynamic(() => import('@/components/JobProgress'), {
  ssr: false,
  loading: () => (
    <div className="muxaro-card p-6 my-6 text-sm text-content-secondary">
      Loading video join progress…
    </div>
  ),
});

export default function VideoMergerPage() {
  const [videoList, setVideoList] = useState<string[]>(['', '']);
  const [outputFormat, setOutputFormat] = useState<string>('mp4');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [backendDisconnected, setBackendDisconnected] = useState<boolean>(false);

  const validNormalizedList = videoList
    .map((v) => normalizeMediaUrl(v))
    .filter((v) => Boolean(v));

  const handleAddVideo = () => {
    setVideoList((prev) => [...prev, '']);
  };

  const handleUpdateVideo = (index: number, val: string) => {
    // Support pasting 2+ newline-separated clip URLs into any slot
    const lines = val
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length > 1) {
      setVideoList((prev) => {
        const next = [...prev];
        lines.forEach((line, offset) => {
          const targetIdx = index + offset;
          if (targetIdx < next.length) {
            next[targetIdx] = line;
          } else {
            next.push(line);
          }
        });
        while (next.length < 2) next.push('');
        return next;
      });
    } else {
      setVideoList((prev) => {
        const updated = [...prev];
        updated[index] = val;
        return updated;
      });
    }
    if (errorMsg) {
      setErrorMsg(null);
      setBackendDisconnected(false);
    }
  };

  const handleRemoveVideo = (index: number) => {
    if (videoList.length <= 2) return;
    setVideoList((prev) => prev.filter((_, i) => i !== index));
  };

  const formatMergeError = (status: number, json: any, fallback: string): string => {
    const code = String(json?.code || json?.error?.code || '').toUpperCase();
    const msg = String(
      json?.error?.userMessage || json?.error?.message || json?.rawMessage || json?.message || ''
    );
    if (
      status === 503 ||
      code === 'ERR_BACKEND_NOT_CONFIGURED' ||
      /ERR_BACKEND_NOT_CONFIGURED|API_INTERNAL_URL|not connected/i.test(msg)
    ) {
      setBackendDisconnected(true);
      return 'Multi-clip video joining requires a connected media processing backend (HTTP 503: ERR_BACKEND_NOT_CONFIGURED). Configure API_INTERNAL_URL / NEXT_PUBLIC_API_URL or connect a custom worker in Settings.';
    }
    if (status === 502 || status === 504 || code === 'ERR_BACKEND_UNREACHABLE') {
      setBackendDisconnected(true);
      return `Could not reach the media processing backend (HTTP ${status}). Verify your worker service is running and try again.`;
    }
    return msg || fallback;
  };

  const hydrateJoinedJob = (raw: any, validClips: string[], requestedFormat: string): ProcessingJob => {
    const payload = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
    const jobId = String(payload?.jobId || payload?.id || '');
    if (!jobId) {
      throw new Error('The merge endpoint did not return a valid job ID.');
    }
    const rawStatus = String(payload?.status || 'QUEUED').toUpperCase();
    const status = (rawStatus === 'COMPLETED' ? 'READY' : rawStatus) as ProcessingJob['status'];
    const progressRaw = Number(payload?.progressPercent ?? payload?.progress);

    return {
      id: jobId,
      jobId,
      jobType: 'transcode_video',
      status,
      operation: String(payload?.operation || 'CONCAT_VIDEO'),
      targetFormat: String(payload?.targetFormat || requestedFormat),
      streamCopy: true,
      progress: Number.isFinite(progressRaw) ? Math.max(0, Math.min(100, Math.round(progressRaw))) : 0,
      progressStage: String(payload?.stageMessage || payload?.stage || 'Queued for clip concatenation'),
      inputTitle: String(payload?.title || payload?.inputTitle || `Joined Video (${validClips.length} clips)`),
      sourceUrl: validClips[0],
      downloadUrl: payload?.downloadUrl || undefined,
      expiresAt: payload?.expiresAt || undefined,
      createdAt: payload?.createdAt || new Date().toISOString(),
    };
  };

  const startJoin = async () => {
    const valid = videoList
      .map((v) => normalizeMediaUrl(v))
      .filter((v) => Boolean(v));

    if (valid.length < 2) {
      setErrorMsg('Please enter at least two authorised video links to join (e.g. youtube.com/watch?v=... or direct MP4s).');
      setBackendDisconnected(false);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setBackendDisconnected(false);

    const idempotencyKey = `join_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const csrfToken = readCsrfTokenFromCookie();
    const authToken = typeof window !== 'undefined' ? window.localStorage.getItem('muxaro_auth_token') : null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
      ...(csrfToken ? { 'x-muxaro-csrf': csrfToken } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    };

    const mergeBody = {
      clipUrls: valid,
      sourceUrl: valid[0],
      operation: 'CONCAT_VIDEO',
      targetFormat: outputFormat,
      streamCopy: true,
      title: `Joined Video (${valid.length} clips)`,
      idempotencyKey,
    };

    const apiBase = getApiBaseUrl().replace(/\/+$/, '');
    const postWithFallback = async (subpath: string, body: Record<string, unknown>) => {
      try {
        const res = await fetch(`${apiBase}${subpath}`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok && apiBase !== '/api/v1' && (res.status === 502 || res.status === 503 || res.status === 504)) {
          return await fetch(`/api/v1${subpath}`, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify(body),
          });
        }
        return res;
      } catch (err) {
        if (apiBase !== '/api/v1') {
          return await fetch(`/api/v1${subpath}`, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify(body),
          });
        }
        throw err;
      }
    };

    try {
      const mergeRes = await postWithFallback('/tools/merge', mergeBody);
      const mergeJson = await mergeRes.json().catch(() => null);

      if (mergeRes.ok && mergeJson?.success !== false) {
        setActiveJob(hydrateJoinedJob(mergeJson, valid, outputFormat));
        return;
      }

      const mergeCode = String(mergeJson?.code || mergeJson?.error?.code || '').toUpperCase();
      // Never mask ERR_BACKEND_NOT_CONFIGURED (503) by falling back to single-clip edge mode
      if (mergeRes.status === 503 || mergeCode === 'ERR_BACKEND_NOT_CONFIGURED') {
        throw new Error(formatMergeError(mergeRes.status, mergeJson, 'Backend API not configured.'));
      }

      // Only fall back to /api/v1/jobs (with full clipUrls) if /tools/merge is not mounted (404/405)
      if (mergeRes.status === 404 || mergeRes.status === 405) {
        const jobsRes = await postWithFallback('/jobs', {
          tool: 'convert_video',
          operation: 'CONCAT_VIDEO',
          sourceUrl: valid[0],
          mediaUrl: valid[0],
          clipUrls: valid,
          targetFormat: outputFormat,
          streamCopy: true,
          title: `Joined Video (${valid.length} clips)`,
          idempotencyKey,
        });
        const jobsJson = await jobsRes.json().catch(() => null);

        if (jobsRes.ok && jobsJson?.success !== false) {
          setActiveJob(hydrateJoinedJob(jobsJson, valid, outputFormat));
          return;
        }
        throw new Error(
          formatMergeError(
            jobsRes.status,
            jobsJson,
            `Could not submit multi-clip join job (HTTP ${jobsRes.status}).`
          )
        );
      }

      // Also fall back to api.createJob only if /tools/merge rejected missing audioUrl on a legacy schema
      if (mergeRes.status === 400 && /audio|video/i.test(String(mergeJson?.error?.message || ''))) {
        const job = await api.createJob({
          sourceUrl: valid[0],
          clipUrls: valid,
          jobType: 'transcode_video',
          operation: 'CONCAT_VIDEO',
          targetFormat: outputFormat,
          streamCopy: true,
          title: `Joined Video (${valid.length} clips)`,
          idempotencyKey,
        });
        setActiveJob(job);
        return;
      }

      throw new Error(
        formatMergeError(
          mergeRes.status,
          mergeJson,
          `Could not join video clips (HTTP ${mergeRes.status}).`
        )
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not join video clips. Check the links and try again.';
      if (/ERR_BACKEND_NOT_CONFIGURED|not connected|API_INTERNAL_URL/i.test(message)) {
        setBackendDisconnected(true);
      }
      setErrorMsg(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await startJoin();
  };

  return (
    <div className="w-full">
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="flex flex-wrap items-center gap-4 mb-6 text-sm">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 font-medium text-content-secondary hover:text-content transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>All tools</span>
            </Link>
            <Link
              href="/"
              className="font-medium text-content-secondary hover:text-content transition-colors"
            >
              Home workspace
            </Link>
          </div>

          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-elevated border border-brand-violet/30 text-xs font-semibold text-brand-violet mb-4 shadow-xs">
              <Film className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Video clip joiner</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
              Join multiple video clips into one file
            </h1>
            <p className="text-base text-content-secondary mt-3 leading-relaxed">
              Concatenate video segments with zero quality degradation via native stream concat demuxing.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 muxaro-media-card p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex items-center justify-between gap-4 pb-3 border-b border-line">
                <span className="text-sm font-semibold text-content">
                  Clip sequence ({videoList.length} slots &middot; {validNormalizedList.length} valid)
                </span>
                <button
                  type="button"
                  onClick={handleAddVideo}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-line bg-surface hover:bg-surface-elevated text-content transition-colors active:scale-[0.98] shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Plus className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                  <span>Add clip</span>
                </button>
              </div>

              <div className="space-y-4">
                {videoList.map((rawUrl, idx) => {
                  const normalized = normalizeMediaUrl(rawUrl);
                  return (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-full bg-surface-elevated border border-line text-brand font-semibold text-xs flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <input
                          type="text"
                          inputMode="url"
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck="false"
                          value={rawUrl}
                          onChange={(e) => handleUpdateVideo(idx, e.target.value)}
                          placeholder={`Paste clip ${idx + 1} link (e.g. youtube.com/watch?v=... or direct MP4)`}
                          aria-label={`Video clip ${idx + 1} URL`}
                          className="flex-1 px-4 py-2.5 rounded-xl bg-surface border border-line text-content placeholder:text-content-muted text-sm transition-colors"
                        />
                        {videoList.length > 2 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveVideo(idx)}
                            aria-label={`Remove clip ${idx + 1}`}
                            className="p-2.5 rounded-xl border border-line bg-surface text-content-muted hover:text-error hover:bg-error-bg/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>

                      {normalized ? (
                        <div className="pl-9">
                          <ActiveLinkIndicator
                            url={normalized}
                            onClear={() => handleUpdateVideo(idx, '')}
                          />
                        </div>
                      ) : rawUrl.trim().length > 0 ? (
                        <p className="pl-9 text-xs text-error">
                          Invalid clip URL — paste a valid http(s) media or playlist link.
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="pt-4 border-t border-line max-w-xs">
                <label
                  htmlFor="video-merger-format"
                  className="block text-sm font-medium text-content mb-2"
                >
                  Output format
                </label>
                <select
                  id="video-merger-format"
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line text-content text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet transition-colors"
                >
                  <option value="mp4">MP4 (Default format)</option>
                  <option value="mkv">MKV (Container)</option>
                  <option value="webm">WebM (Web stream)</option>
                </select>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-error-bg border border-error text-sm text-error flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {backendDisconnected && (
                      <Link
                        href="/settings?tab=instances"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                      >
                        Configure Backend
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={startJoin}
                      disabled={isSubmitting || validNormalizedList.length < 2}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error bg-surface text-error text-xs font-semibold hover:bg-surface-elevated transition-colors active:opacity-90 disabled:opacity-50 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Retry</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || validNormalizedList.length < 2}
                  className="px-6 py-3 rounded-full bg-brand-violet text-white text-sm font-semibold hover:bg-brand-violet/90 active:scale-[0.98] transition-transform shadow-xs disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2"
                >
                  {isSubmitting ? 'Joining clips…' : `Join ${validNormalizedList.length || 2} clips`}
                </button>
                <span className="text-xs text-content-secondary">
                  Uses 1 of your 10 daily free media jobs
                </span>
              </div>
            </form>

            {activeJob && (
              <div className="mt-8 pt-6 border-t border-line">
                <JobProgress
                  initialJob={activeJob}
                  onJobUpdate={setActiveJob}
                  onDismiss={() => setActiveJob(null)}
                />
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="muxaro-media-card p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <Film className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Concatenation specs</span>
              </div>
              <ul className="space-y-3 text-xs text-content-secondary leading-relaxed">
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Zero re-encoding required when codecs match for instant assembly.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Accurate PTS timestamp stitching prevents video playback stutter.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    className="w-4 h-4 text-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>Automated track alignment across video, audio, and subtitle streams.</span>
                </li>
              </ul>
            </div>

            <div className="muxaro-media-card p-6 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-content">
                <ShieldCheck className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>Automatic cleanup</span>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed">
                Source clips and concatenated files are isolated and automatically expired from disk.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
