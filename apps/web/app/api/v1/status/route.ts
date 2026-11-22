import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { jobManager } from '@/lib/job-manager';
import type { SystemHealthStatus } from '@/lib/contracts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface BinaryVersionCache {
  ytdlp: { available: boolean; version?: string };
  ffmpeg: { available: boolean; version?: string };
  ffprobe: { available: boolean; version?: string };
  lastChecked: number;
}

let cachedStatus: BinaryVersionCache | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

function queryBinaryVersion(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
    });

    let output = '';
    child.stdout.on('data', (d) => {
      output += d.toString('utf8');
    });

    child.on('error', () => {
      resolve(undefined);
    });

    child.on('close', (code) => {
      if (code === 0 && output.trim()) {
        // Return first clean line
        const firstLine = output.trim().split(/\r?\n/)[0].trim();
        resolve(firstLine);
      } else {
        resolve(undefined);
      }
    });
  });
}

async function getBinaryVersions(): Promise<BinaryVersionCache> {
  const now = Date.now();
  if (cachedStatus && now - cachedStatus.lastChecked < CACHE_TTL_MS) {
    return cachedStatus;
  }

  const [ytdlpVer, ffmpegVerRaw, ffprobeVerRaw] = await Promise.all([
    queryBinaryVersion('yt-dlp', ['--version']),
    queryBinaryVersion('ffmpeg', ['-version']),
    queryBinaryVersion('ffprobe', ['-version']),
  ]);

  // Extract clean version string from "ffmpeg version X.X.X..."
  let ffmpegVer: string | undefined;
  if (ffmpegVerRaw) {
    const match = ffmpegVerRaw.match(/ffmpeg version ([^\s]+)/i);
    ffmpegVer = match ? match[1] : ffmpegVerRaw;
  }

  let ffprobeVer: string | undefined;
  if (ffprobeVerRaw) {
    const match = ffprobeVerRaw.match(/ffprobe version ([^\s]+)/i);
    ffprobeVer = match ? match[1] : ffprobeVerRaw;
  }

  cachedStatus = {
    ytdlp: {
      available: Boolean(ytdlpVer),
      version: ytdlpVer,
    },
    ffmpeg: {
      available: Boolean(ffmpegVer),
      version: ffmpegVer,
    },
    ffprobe: {
      available: Boolean(ffprobeVer),
      version: ffprobeVer,
    },
    lastChecked: now,
  };

  return cachedStatus;
}

export async function GET() {
  const binaries = await getBinaryVersions();
  const allJobs = jobManager.listJobs();
  const activeJobs = allJobs.filter(
    (j) => j.status !== 'ready' && j.status !== 'failed' && j.status !== 'cancelled'
  ).length;

  const isHealthy = binaries.ytdlp.available && binaries.ffmpeg.available;

  const healthData: SystemHealthStatus & { version: string; runtime: string } = {
    status: isHealthy ? 'healthy' : 'degraded',
    version: '2.0.0',
    runtime: 'node-media-systems',
    ytdlp: binaries.ytdlp,
    ffmpeg: binaries.ffmpeg,
    ffprobe: binaries.ffprobe,
    activeJobs,
    maxConcurrentJobs: 10,
    checkedAt: new Date().toISOString(),
  };

  return NextResponse.json({
    success: true,
    data: healthData,
    requestId: `status_${Date.now()}`,
  });
}
