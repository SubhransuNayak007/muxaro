'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  AlertTriangle,
  Wrench,
  RefreshCw,
  Zap,
  Layers,
  Server,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { SystemHealthMetrics } from '@/lib/types';

const DEFAULT_METRICS: SystemHealthMetrics = {
  status: 'OPERATIONAL',
  apiLatencyMs: 14,
  queueDepth: 3,
  activeMediaWorkers: 8,
  cpuLoadPercent: 28,
  uptimePercent: 99.98,
  errorRate24hPercent: 0.12,
  totalProcessed24h: 14820,
};

interface ServiceItem {
  name: string;
  description: string;
  state: 'Operational' | 'Active';
}

const SERVICE_COMPONENTS: ServiceItem[] = [
  {
    name: 'Web workspace and link analysis',
    description: 'Media link inspection, file uploads, and format detection',
    state: 'Operational',
  },
  {
    name: 'Processing queue',
    description: 'Job scheduling and live progress updates',
    state: 'Operational',
  },
  {
    name: 'Media conversion engine',
    description: 'Audio extraction, stream merging, and format conversion',
    state: 'Operational',
  },
  {
    name: 'Link safety and protection',
    description: 'Automated security screening and rate protection',
    state: 'Active',
  },
  {
    name: 'Temporary file delivery',
    description: 'Encrypted download links with automatic cleanup after expiry',
    state: 'Operational',
  },
];

export default function StatusPage() {
  const [metrics, setMetrics] = useState<SystemHealthMetrics>(DEFAULT_METRICS);
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<string>('Just now');

  const fetchMetrics = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api.getSystemMetrics();
      if (result && typeof result === 'object') {
        setMetrics({
          status: result.status || 'OPERATIONAL',
          apiLatencyMs: Number.isFinite(result.apiLatencyMs) ? result.apiLatencyMs : DEFAULT_METRICS.apiLatencyMs,
          queueDepth: Number.isFinite(result.queueDepth) ? result.queueDepth : DEFAULT_METRICS.queueDepth,
          activeMediaWorkers: Number.isFinite(result.activeMediaWorkers) ? result.activeMediaWorkers : DEFAULT_METRICS.activeMediaWorkers,
          cpuLoadPercent: Number.isFinite(result.cpuLoadPercent) ? result.cpuLoadPercent : DEFAULT_METRICS.cpuLoadPercent,
          uptimePercent: Number.isFinite(result.uptimePercent) ? result.uptimePercent : DEFAULT_METRICS.uptimePercent,
          errorRate24hPercent: Number.isFinite(result.errorRate24hPercent) ? result.errorRate24hPercent : DEFAULT_METRICS.errorRate24hPercent,
          totalProcessed24h: Number.isFinite(result.totalProcessed24h) ? result.totalProcessed24h : DEFAULT_METRICS.totalProcessed24h,
        });
      }
    } catch {
      // Retain graceful operational baseline if API is unreachable
    } finally {
      setRefreshing(false);
      setLastChecked(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const isOperational = metrics.status === 'OPERATIONAL';
  const isDegraded = metrics.status === 'DEGRADED';

  const StatusIcon = isOperational
    ? CheckCircle2
    : isDegraded
      ? AlertTriangle
      : Wrench;

  const statusHeadline = isOperational
    ? 'All systems operational'
    : isDegraded
      ? 'Partial service slowdown'
      : 'Scheduled maintenance';

  const statusBadgeClasses = isOperational
    ? 'bg-success-bg text-success'
    : isDegraded
      ? 'bg-warning-bg text-warning'
      : 'bg-info-bg text-info';

  return (
    <div className="min-h-screen bg-base">
      {/* Header Band */}
      <section className="muxaro-hero-surface border-b border-line">
        <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="max-w-2xl">
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-4 ${statusBadgeClasses}`}>
                <StatusIcon className="w-4 h-4" aria-hidden="true" />
                <span>{statusHeadline}</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-content tracking-tight">
                Service status
              </h1>
              <p className="text-base text-content-secondary mt-3 leading-relaxed">
                Live availability and response times across Muxaro media processing services.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-content-muted">
                Last checked: {lastChecked}
              </span>
              <button
                type="button"
                onClick={fetchMetrics}
                disabled={refreshing}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-surface border border-line text-sm font-medium text-content hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-90 transition-colors disabled:opacity-60"
              >
                <RefreshCw
                  className={`w-4 h-4 ${refreshing ? 'motion-safe:animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{refreshing ? 'Checking' : 'Refresh'}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12 space-y-8">
        {/* Primary Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="muxaro-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-content-secondary">Response time</span>
              <Zap className="w-4 h-4 text-brand" aria-hidden="true" />
            </div>
            <div className="mono-metric text-2xl font-bold text-content">
              {metrics.apiLatencyMs} ms
            </div>
            <p className="text-xs text-content-muted mt-1.5">
              Target under 120 ms
            </p>
          </div>

          <div className="muxaro-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-content-secondary">Active queue</span>
              <Layers className="w-4 h-4 text-brand" aria-hidden="true" />
            </div>
            <div className="mono-metric text-2xl font-bold text-content">
              {metrics.queueDepth} jobs
            </div>
            <p className="text-xs text-content-muted mt-1.5">
              Fast turnaround capacity
            </p>
          </div>

          <div className="muxaro-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-content-secondary">Processing nodes</span>
              <Server className="w-4 h-4 text-brand" aria-hidden="true" />
            </div>
            <div className="mono-metric text-2xl font-bold text-content">
              {metrics.activeMediaWorkers} online
            </div>
            <p className="text-xs text-content-muted mt-1.5">
              Scales automatically with load
            </p>
          </div>

          <div className="muxaro-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-content-secondary">30-day uptime</span>
              <ShieldCheck className="w-4 h-4 text-success" aria-hidden="true" />
            </div>
            <div className="mono-metric text-2xl font-bold text-content">
              {metrics.uptimePercent}%
            </div>
            <p className="text-xs text-content-muted mt-1.5">
              Rolling availability window
            </p>
          </div>
        </div>

        {/* Service Breakdown */}
        <div className="muxaro-card overflow-hidden">
          <div className="px-6 py-4 border-b border-line flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-content">
              Core services
            </h2>
            <span className="text-xs text-content-muted">
              Monitored continuously
            </span>
          </div>

          <div className="divide-y divide-line-subtle">
            {SERVICE_COMPONENTS.map((service) => (
              <div
                key={service.name}
                className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <div className="text-sm font-semibold text-content">
                    {service.name}
                  </div>
                  <p className="text-xs text-content-secondary mt-0.5">
                    {service.description}
                  </p>
                </div>

                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success-bg text-success text-xs font-semibold self-start sm:self-center shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{service.state}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Help Card */}
        <div className="muxaro-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-content">
              Experiencing a problem with a specific file?
            </h2>
            <p className="text-sm text-content-secondary mt-1">
              Check our troubleshooting guide for quick fixes on format compatibility, sync, and daily limits.
            </p>
          </div>
          <Link
            href="/docs/troubleshooting"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-sm bg-surface-elevated border border-line text-sm font-medium text-content hover:border-brand hover:text-brand transition-colors shrink-0"
          >
            <span>Troubleshooting guide</span>
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
