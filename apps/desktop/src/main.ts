import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, shell } from 'electron';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

interface LocalJob {
  id: string;
  state: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progressPct: number;
  stage: string;
  title: string;
  outputPath?: string;
  filename?: string;
  sizeBytes?: number;
  mimeType?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  listeners: Set<http.ServerResponse>;
}

interface LocalUploadSession {
  id: string;
  filename: string;
  mimeType: string;
  partsDir: string;
  finalPath?: string;
  sizeBytes: number;
}

const jobs = new Map<string, LocalJob>();
const uploadedFiles = new Map<string, LocalUploadSession>();

function resolveBundledOrSystemBinary(name: 'ffmpeg' | 'ffprobe' | 'yt-dlp'): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates: string[] = [];

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'bin', exe));
  }
  candidates.push(path.join(__dirname, '..', 'bin', exe));
  candidates.push(path.join(app.getPath('userData'), 'bin', exe));

  if (name === 'ffmpeg') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const staticPath = require('ffmpeg-static');
      if (typeof staticPath === 'string' && staticPath) {
        candidates.push(staticPath);
      }
    } catch {
      // Ignore if ffmpeg-static unavailable
    }
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return exe;
}

function getWorkDir(): string {
  const dir = path.join(os.tmpdir(), 'muxaro-desktop-jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getUploadDir(): string {
  const dir = path.join(os.tmpdir(), 'muxaro-desktop-uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getUserMuxaroDownloadsDir(): string {
  const dir = path.join(app.getPath('downloads'), 'MUXARO');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeFileName(name: string): string {
  return path.basename(name || 'media.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function validateHttpUrl(raw: string): URL {
  const parsed = new URL(raw.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are allowed.');
  }
  return parsed;
}

async function readBufferBody(req: http.IncomingMessage, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error('Payload exceeded desktop upload buffer limit.');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const buf = await readBufferBody(req, 16 * 1024 * 1024);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function emitJobUpdate(job: LocalJob): void {
  job.updatedAt = new Date().toISOString();
  const payload = JSON.stringify({
    id: job.id,
    state: job.state,
    status: job.state,
    progressPct: job.progressPct,
    progress: job.progressPct,
    stage: job.stage,
    title: job.title,
    filename: job.filename,
    sizeBytes: job.sizeBytes,
    error: job.error,
  });
  for (const listener of job.listeners) {
    try {
      listener.write(`event: progress\ndata: ${payload}\n\n`);
    } catch {
      job.listeners.delete(listener);
    }
  }
}

async function runYtdlpProbe(urlStr: string): Promise<any> {
  const url = validateHttpUrl(urlStr);
  const ytdlp = resolveBundledOrSystemBinary('yt-dlp');
  const { stdout } = await execFileAsync(
    ytdlp,
    ['--dump-single-json', '--no-warnings', '--no-playlist', url.toString()],
    { timeout: 35000, maxBuffer: 16 * 1024 * 1024 }
  );
  const info = JSON.parse(stdout);
  const formatsRaw = Array.isArray(info.formats) ? info.formats : [];
  const formats = formatsRaw
    .filter((f: any) => f && f.format_id)
    .slice(0, 48)
    .map((f: any) => ({
      formatId: String(f.format_id),
      ext: String(f.ext || 'mp4'),
      resolution:
        f.height && f.width
          ? `${f.width}x${f.height}`
          : f.height
          ? `${f.height}p`
          : f.vcodec === 'none'
          ? 'audio'
          : 'best',
      fps: typeof f.fps === 'number' ? f.fps : undefined,
      filesize:
        typeof f.filesize === 'number'
          ? f.filesize
          : typeof f.filesize_approx === 'number'
          ? f.filesize_approx
          : undefined,
      hasVideo: Boolean(f.vcodec && f.vcodec !== 'none'),
      hasAudio: Boolean(f.acodec && f.acodec !== 'none'),
      vcodec: f.vcodec,
      acodec: f.acodec,
      tbr: f.tbr,
      note: f.format_note || undefined,
    }));

  return {
    title: info.title || 'Media Stream',
    durationSec: typeof info.duration === 'number' ? info.duration : 0,
    thumbnail: info.thumbnail || '',
    uploader: info.uploader || info.channel || '',
    sourceUrl: url.toString(),
    formats,
  };
}

function buildFfmpegArgsForLocalJob(
  inputPath: string,
  outputPath: string,
  body: Record<string, any>
): { args: string[]; label: string } {
  const tool = String(body.tool || body.jobType || body.operation || '').toLowerCase();
  const targetFmt = path.extname(outputPath).replace('.', '').toLowerCase() || 'mp4';

  // Target-size compression (Discord 10MB / WhatsApp 16MB / custom)
  if (tool.includes('compress')) {
    const targetMb = Math.max(1, Number(body.targetSizeMb) || 10);
    const estKbps = Math.max(180, Math.min(8000, Math.round((targetMb * 7600) / 30)));
    const mute = Boolean(body.muteVideo);
    const maxRes = String(body.maxResolution || 'auto');
    const vf =
      maxRes === '480p'
        ? 'scale=-2:480:flags=lanczos'
        : maxRes === '720p'
        ? 'scale=-2:720:flags=lanczos'
        : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
    const args = ['-y', '-i', inputPath, '-vf', vf, '-c:v', 'libx264', '-b:v', `${estKbps}k`, '-preset', 'fast'];
    if (mute) {
      args.push('-an');
    } else {
      args.push('-c:a', 'aac', '-b:a', '96k');
    }
    args.push('-movflags', '+faststart', outputPath);
    return { args, label: `Compressing locally to ${targetMb} MB…` };
  }

  // EBU R128 Audio Loudness Normalizer
  if (tool.includes('normalizer') || tool.includes('loudnorm')) {
    const lufs = Number(body.targetLufs) || -14;
    const tp = Number(body.truePeak) || -1;
    const lra = Number(body.lra) || 11;
    const isAudioOnly = ['mp3', 'flac', 'wav', 'm4a', 'opus'].includes(targetFmt);
    const args = ['-y', '-i', inputPath];
    if (isAudioOnly) {
      args.push('-vn');
    } else {
      args.push('-c:v', 'copy');
    }
    args.push('-af', `loudnorm=I=${lufs}:TP=${tp}:LRA=${lra}:linear=true`, '-ar', '48000', outputPath);
    return { args, label: `Normalizing loudness locally (${lufs} LUFS)…` };
  }

  // Aspect Ratio & 9:16 Smart Pad
  if (tool.includes('aspect')) {
    const ratio = String(body.aspectRatio || '9:16');
    const fill = String(body.fillMode || 'blur');
    const dims =
      ratio === '1:1'
        ? { w: 1080, h: 1080 }
        : ratio === '4:5'
        ? { w: 1080, h: 1350 }
        : ratio === '16:9'
        ? { w: 1920, h: 1080 }
        : { w: 1080, h: 1920 };
    if (fill === 'crop') {
      return {
        args: [
          '-y',
          '-i',
          inputPath,
          '-vf',
          `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=increase,crop=${dims.w}:${dims.h}`,
          '-c:a',
          'copy',
          outputPath,
        ],
        label: `Cropping locally to ${ratio}…`,
      };
    }
    if (fill === 'black') {
      return {
        args: [
          '-y',
          '-i',
          inputPath,
          '-vf',
          `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=decrease,pad=${dims.w}:${dims.h}:(ow-iw)/2:(oh-ih)/2`,
          '-c:a',
          'copy',
          outputPath,
        ],
        label: `Padding locally to ${ratio}…`,
      };
    }
    const blur = Math.max(5, Math.min(40, Number(body.blurStrength) || 18));
    return {
      args: [
        '-y',
        '-i',
        inputPath,
        '-filter_complex',
        `[0:v]scale=${dims.w}:${dims.h}:force_original_aspect_ratio=increase,crop=${dims.w}:${dims.h},boxblur=${blur}[bg];[0:v]scale=${dims.w}:${dims.h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`,
        '-c:a',
        'copy',
        outputPath,
      ],
      label: `Rendering ${ratio} blur-fill locally…`,
    };
  }

  // Video to GIF / Animated WebP
  if (tool.includes('gif')) {
    const fps = Math.max(5, Math.min(30, Number(body.fps) || 12));
    const width = Number(body.width) > 0 ? Number(body.width) : 480;
    const trimArgs: string[] = [];
    if (body.startTime) trimArgs.push('-ss', String(body.startTime));
    if (body.endTime) trimArgs.push('-to', String(body.endTime));
    if (targetFmt === 'webp') {
      return {
        args: [
          '-y',
          ...trimArgs,
          '-i',
          inputPath,
          '-vf',
          `fps=${fps},scale=${width}:-1:flags=lanczos`,
          '-loop',
          '0',
          outputPath,
        ],
        label: 'Encoding animated WebP locally…',
      };
    }
    return {
      args: [
        '-y',
        ...trimArgs,
        '-i',
        inputPath,
        '-vf',
        `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
        outputPath,
      ],
      label: 'Generating PaletteGen GIF locally…',
    };
  }

  // Audio Extraction
  if (tool.includes('extract_audio') || ['mp3', 'flac', 'wav', 'm4a', 'opus'].includes(targetFmt)) {
    return {
      args: ['-y', '-i', inputPath, '-vn', outputPath],
      label: `Extracting ${targetFmt.toUpperCase()} audio locally…`,
    };
  }

  // Lossless Trimmer
  if (tool.includes('trim')) {
    const args = ['-y'];
    if (body.startTime !== undefined && body.startTime !== '') args.push('-ss', String(body.startTime));
    args.push('-i', inputPath);
    if (body.endTime !== undefined && body.endTime !== '') args.push('-to', String(body.endTime));
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
    if (targetFmt === 'mp4') args.push('-movflags', '+faststart');
    args.push(outputPath);
    return { args, label: 'Trimming media cleanly locally…' };
  }

  // Metadata Scrubber
  if (tool.includes('scrub') || tool.includes('metadata')) {
    return {
      args: [
        '-y',
        '-i',
        inputPath,
        '-map',
        '0:V?',
        '-map',
        '0:a?',
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-c',
        'copy',
        outputPath,
      ],
      label: 'Scrubbing metadata cleanly locally…',
    };
  }

  // Generic Transcode / Convert
  return {
    args: ['-y', '-i', inputPath, '-movflags', '+faststart', outputPath],
    label: `Converting media locally to .${targetFmt}…`,
  };
}

function startLocalProcessingJob(body: Record<string, any>): LocalJob {
  const id = `local_job_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const job: LocalJob = {
    id,
    state: 'processing',
    progressPct: 6,
    stage: 'Starting local desktop engine…',
    title: sanitizeFileName(String(body.title || 'muxaro-output')),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    listeners: new Set(),
  };
  jobs.set(id, job);

  void (async () => {
    try {
      const ffmpeg = resolveBundledOrSystemBinary('ffmpeg');
      const ytdlp = resolveBundledOrSystemBinary('yt-dlp');
      const outDir = getWorkDir();

      // Resolve existing uploaded file or chained local job
      let inputPath: string | undefined;
      let baseTitle = sanitizeFileName(String(body.title || 'muxaro-output')).replace(/\.[^.]+$/, '');

      if (body.mediaAssetId && uploadedFiles.has(String(body.mediaAssetId))) {
        const up = uploadedFiles.get(String(body.mediaAssetId))!;
        inputPath = up.finalPath;
        baseTitle = up.filename.replace(/\.[^.]+$/, '') || baseTitle;
      } else if (body.sourceJobId && jobs.has(String(body.sourceJobId))) {
        const prev = jobs.get(String(body.sourceJobId))!;
        inputPath = prev.outputPath;
        baseTitle = (prev.filename || baseTitle).replace(/\.[^.]+$/, '');
      }

      // If no local file yet, download URL first via bundled yt-dlp
      if (!inputPath && (body.sourceUrl || body.url)) {
        const url = validateHttpUrl(String(body.sourceUrl || body.url));
        const template = path.join(outDir, `${id}_%(title).60B.%(ext)s`);
        const ytdlpArgs = ['--no-playlist', '--newline', '--no-warnings', '-o', template];
        if (ffmpeg && fs.existsSync(ffmpeg)) {
          ytdlpArgs.push('--ffmpeg-location', path.dirname(ffmpeg));
        }

        const isPureDownload =
          !body.tool ||
          String(body.tool).toLowerCase() === 'download' ||
          String(body.jobType || '').toLowerCase() === 'download';

        if (body.mode === 'audio' || body.quality === 'mp3') {
          ytdlpArgs.push('-x', '--audio-format', body.quality === 'lossless' ? 'flac' : 'mp3');
        } else if (body.formatId) {
          ytdlpArgs.push('-f', `${String(body.formatId)}+bestaudio/best`, '--merge-output-format', 'mp4');
        } else {
          ytdlpArgs.push('-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4');
        }
        ytdlpArgs.push(url.toString());

        await new Promise<void>((resolve, reject) => {
          const proc = spawn(ytdlp, ytdlpArgs, { windowsHide: true });
          let stderr = '';
          proc.stdout.on('data', (chunk: Buffer) => {
            const m = chunk.toString('utf8').match(/(\d+(?:\.\d+)?)%/);
            if (m) {
              const pct = Math.min(isPureDownload ? 95 : 50, Math.max(5, Math.round(Number(m[1]))));
              job.progressPct = pct;
              job.stage = `Downloading locally (${pct}%)…`;
              emitJobUpdate(job);
            }
          });
          proc.stderr.on('data', (c: Buffer) => {
            stderr += c.toString('utf8');
          });
          proc.on('error', reject);
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
          });
        });

        const dlFiles = fs
          .readdirSync(outDir)
          .filter((f) => f.startsWith(`${id}_`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
        if (!dlFiles.length) {
          throw new Error('Local yt-dlp finished without writing an output file.');
        }
        inputPath = path.join(outDir, dlFiles[0]);
        baseTitle = dlFiles[0].replace(`${id}_`, '').replace(/\.[^.]+$/, '');

        if (isPureDownload) {
          const stat = fs.statSync(inputPath);
          const cleanName = dlFiles[0].replace(`${id}_`, '');
          const ext = path.extname(cleanName).toLowerCase();
          job.outputPath = inputPath;
          job.filename = cleanName;
          job.title = cleanName;
          job.sizeBytes = stat.size;
          job.mimeType = MIME_TYPES[ext] || 'application/octet-stream';
          job.state = 'completed';
          job.progressPct = 100;
          job.stage = 'Saved cleanly on your device';
          emitJobUpdate(job);
          try {
            fs.copyFileSync(inputPath, path.join(getUserMuxaroDownloadsDir(), cleanName));
          } catch {}
          return;
        }
      }

      if (!inputPath || !fs.existsSync(inputPath)) {
        throw new Error('No valid local input media found for FFmpeg task.');
      }

      let outExt = String(body.targetFormat || 'mp4').replace(/^\./, '').toLowerCase();
      if (outExt === 'source') {
        outExt = path.extname(inputPath).replace(/^\./, '').toLowerCase() || 'mp4';
      }
      const cleanName = `${baseTitle}-${id.slice(-5)}.${outExt}`;
      const outputPath = path.join(outDir, `${id}_${cleanName}`);
      const { args, label } = buildFfmpegArgsForLocalJob(inputPath, outputPath, body);

      job.stage = label;
      job.progressPct = Math.max(job.progressPct, 35);
      emitJobUpdate(job);

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpeg, args, { windowsHide: true });
        let stderr = '';
        proc.stderr.on('data', (c: Buffer) => {
          stderr += c.toString('utf8');
        });
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(stderr.slice(-600).trim() || `FFmpeg exited with code ${code}`));
        });
      });

      const stat = fs.statSync(outputPath);
      job.outputPath = outputPath;
      job.filename = cleanName;
      job.title = cleanName;
      job.sizeBytes = stat.size;
      job.mimeType = MIME_TYPES[`.${outExt}`] || 'application/octet-stream';
      job.state = 'completed';
      job.progressPct = 100;
      job.stage = 'Completed cleanly on device';
      emitJobUpdate(job);

      try {
        fs.copyFileSync(outputPath, path.join(getUserMuxaroDownloadsDir(), cleanName));
      } catch {}
    } catch (err) {
      job.state = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      job.stage = 'Local desktop execution failed';
      emitJobUpdate(job);
    }
  })();

  return job;
}

function createLocalServer(webDistDir: string): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(reqUrl.pathname);

      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      if (pathname.startsWith('/api/v1/')) {
        if (pathname === '/api/v1/health' || pathname === '/api/v1/ready') {
          return sendJson(res, 200, {
            ok: true,
            status: 'healthy',
            mode: 'desktop-local',
            ffmpeg: Boolean(resolveBundledOrSystemBinary('ffmpeg')),
            ytdlp: Boolean(resolveBundledOrSystemBinary('yt-dlp')),
          });
        }

        if (pathname === '/api/v1/status') {
          return sendJson(res, 200, {
            ok: true,
            status: 'operational',
            mode: 'desktop-local',
            queues: { active: 0, waiting: 0 },
          });
        }

        if (pathname === '/api/v1/security/challenge') {
          const cid = crypto.randomUUID();
          const salt = crypto.randomBytes(12).toString('hex');
          return sendJson(res, 200, {
            ok: true,
            success: true,
            data: {
              challengeToken: cid,
              alreadyVerified: true,
              captchaToken: `desktop_local_${crypto.randomBytes(16).toString('hex')}`,
              pow: { salt, difficultyBits: 8 },
            },
          });
        }

        if (pathname === '/api/v1/security/verify-challenge' && req.method === 'POST') {
          const tok = `desktop_local_${crypto.randomBytes(16).toString('hex')}`;
          return sendJson(res, 200, {
            ok: true,
            success: true,
            token: tok,
            data: { captchaToken: tok },
          });
        }

        if (pathname === '/api/v1/native/fetch-url' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const rawUrl = String(body?.url || '').trim();
          const parsed = validateHttpUrl(rawUrl);
          const host = parsed.hostname.toLowerCase();
          if (
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '::1' ||
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            host.startsWith('169.254.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host)
          ) {
            return sendJson(res, 403, {
              ok: false,
              error: { code: 'SSRF_BLOCKED', message: 'Private or loopback addresses are blocked.' },
            });
          }

          const headers: Record<string, string> = {
            'User-Agent': 'MUXARO-Desktop/1.0',
          };
          if (body?.authorization && typeof body.authorization === 'string') {
            headers['Authorization'] = body.authorization;
          }

          let upstream = await fetch(parsed.toString(), { headers, redirect: 'follow' });
          let ct = upstream.headers.get('content-type') || 'application/octet-stream';

          // Handle Google Drive virus-scan confirmation page for larger files
          if (
            upstream.ok &&
            ct.includes('text/html') &&
            parsed.hostname.includes('drive.google.com')
          ) {
            const html = await upstream.text();
            const confirmMatch =
              html.match(/name="confirm"\s+value="([^"]+)"/i) ||
              html.match(/confirm=([0-9A-Za-z_-]+)/i);
            const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/i);
            const idMatch = parsed.searchParams.get('id') || '';
            if (confirmMatch && idMatch) {
              const confirmUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(idMatch)}&export=download&confirm=${encodeURIComponent(confirmMatch[1])}${uuidMatch ? `&uuid=${encodeURIComponent(uuidMatch[1])}` : ''}`;
              upstream = await fetch(confirmUrl, { headers, redirect: 'follow' });
              ct = upstream.headers.get('content-type') || 'application/octet-stream';
            } else {
              throw new Error('Google Drive link is not public or requires sign-in.');
            }
          }

          if (!upstream.ok) {
            return sendJson(res, upstream.status, {
              ok: false,
              error: { code: 'FETCH_FAILED', message: `Remote host returned ${upstream.status}` },
            });
          }

          const disp = upstream.headers.get('content-disposition') || '';
          const fnMatch = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i);
          const urlName = path.basename(parsed.pathname) || 'imported-file';
          const outFilename = sanitizeFileName(fnMatch?.[1] ? decodeURIComponent(fnMatch[1]) : urlName);
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(200, {
            'Content-Type': ct,
            'Content-Length': buf.length,
            'X-Muxaro-Filename': encodeURIComponent(outFilename),
            'Cache-Control': 'no-store',
          });
          res.end(buf);
          return;
        }

        // Local Upload Sessions (/api/v1/uploads/init + /api/v1/media/upload/*)
        if (
          (pathname === '/api/v1/uploads/init' || pathname === '/api/v1/media/upload/init') &&
          req.method === 'POST'
        ) {
          const body = await readJsonBody(req);
          const id = `up_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
          const filename = sanitizeFileName(String(body.filename || 'media.bin'));
          const partsDir = path.join(getUploadDir(), id);
          fs.mkdirSync(partsDir, { recursive: true });
          uploadedFiles.set(id, {
            id,
            filename,
            mimeType: String(body.mimeType || 'application/octet-stream'),
            partsDir,
            sizeBytes: Number(body.sizeBytes || body.totalSize || 0),
          });
          const chunkSize = 3670016;
          const totalChunks = Math.max(1, Math.ceil((Number(body.sizeBytes || body.totalSize || chunkSize)) / chunkSize));
          return sendJson(res, 200, {
            ok: true,
            uploadId: id,
            uploadSessionId: id,
            mode: 'chunked',
            chunkSize,
            chunkSizeHint: chunkSize,
            totalChunks,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            data: {
              uploadSessionId: id,
              uploadId: id,
              mode: 'chunked',
              chunkSize,
              chunkSizeHint: chunkSize,
              totalChunks,
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            },
          });
        }

        const partMatch = pathname.match(/^\/api\/v1\/media\/upload\/([^/]+)\/part\/(\d+)$/);
        if (partMatch && req.method === 'PUT') {
          const session = uploadedFiles.get(partMatch[1]);
          if (!session) {
            return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Upload session not found' } });
          }
          const partBuf = await readBufferBody(req, 16 * 1024 * 1024);
          fs.writeFileSync(path.join(session.partsDir, `part_${partMatch[2]}`), partBuf);
          return sendJson(res, 200, { ok: true, partNumber: Number(partMatch[2]), sizeBytes: partBuf.length });
        }

        const completeMatch = pathname.match(/^\/api\/v1\/(?:media\/upload|uploads)\/([^/]+)\/complete$/);
        if (completeMatch && req.method === 'POST') {
          const session = uploadedFiles.get(completeMatch[1]);
          if (!session) {
            return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Upload session not found' } });
          }
          const partFiles = fs
            .readdirSync(session.partsDir)
            .filter((f) => f.startsWith('part_'))
            .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
          const finalPath = path.join(session.partsDir, session.filename);
          const outStream = fs.createWriteStream(finalPath);
          let totalBytes = 0;
          for (const pf of partFiles) {
            const chunk = fs.readFileSync(path.join(session.partsDir, pf));
            totalBytes += chunk.length;
            outStream.write(chunk);
          }
          await new Promise<void>((resolve) => outStream.end(resolve));
          session.finalPath = finalPath;
          session.sizeBytes = totalBytes;
          return sendJson(res, 200, {
            ok: true,
            uploadId: session.id,
            uploadSessionId: session.id,
            mediaAssetId: session.id,
            assetId: session.id,
            id: session.id,
            filename: session.filename,
            sizeBytes: totalBytes,
          });
        }

        if ((pathname === '/api/v1/analyse' || pathname === '/api/v1/probe') && req.method === 'POST') {
          const body = await readJsonBody(req);
          if (!body?.url) {
            return sendJson(res, 400, { ok: false, success: false, error: { code: 'ERR_MISSING_URL', message: 'URL is required' } });
          }
          const manifest = await runYtdlpProbe(String(body.url));
          return sendJson(res, 200, { ok: true, success: true, data: manifest, manifest, ...manifest });
        }

        if (pathname === '/api/v1/jobs' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const job = startLocalProcessingJob(body || {});
          const jobObj = {
            id: job.id,
            state: job.state,
            status: job.state,
            progressPct: job.progressPct,
            stage: job.stage,
            title: job.title,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
          };
          return sendJson(res, 201, {
            ok: true,
            success: true,
            data: jobObj,
            job: jobObj,
          });
        }

        const jobEventsMatch = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/events$/);
        if (jobEventsMatch) {
          const job = jobs.get(jobEventsMatch[1]);
          if (!job) {
            return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } });
          }
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          });
          job.listeners.add(res);
          emitJobUpdate(job);
          req.on('close', () => job.listeners.delete(res));
          return;
        }

        const jobDlMatch = pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/download$/);
        if (jobDlMatch) {
          const job = jobs.get(jobDlMatch[1]);
          if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
            return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Output not found' } });
          }
          const stat = fs.statSync(job.outputPath);
          res.writeHead(200, {
            'Content-Type': job.mimeType || 'application/octet-stream',
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="${encodeURIComponent(job.filename || 'muxaro-output')}"`,
          });
          fs.createReadStream(job.outputPath).pipe(res);
          return;
        }

        const jobGetMatch = pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/);
        if (jobGetMatch) {
          const job = jobs.get(jobGetMatch[1]);
          if (!job) {
            return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } });
          }
          const jobObj = {
            id: job.id,
            state: job.state,
            status: job.state,
            progressPct: job.progressPct,
            stage: job.stage,
            title: job.title,
            filename: job.filename,
            sizeBytes: job.sizeBytes,
            error: job.error,
          };
          return sendJson(res, 200, {
            ok: true,
            success: true,
            data: jobObj,
            ...jobObj,
          });
        }

        return sendJson(res, 200, { ok: true, mode: 'desktop-local', uploads: uploadedFiles.size });
      }

      // Serve static built Next.js files cleanly
      const rel = pathname === '/' ? '/index.html' : pathname;
      let resolvedPath = path.normalize(path.join(webDistDir, rel));
      if (!resolvedPath.startsWith(path.normalize(webDistDir))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        resolvedPath = path.join(resolvedPath, 'index.html');
      } else if (!fs.existsSync(resolvedPath)) {
        const htmlAttempt = `${resolvedPath}.html`;
        const indexAttempt = path.join(resolvedPath, 'index.html');
        if (fs.existsSync(indexAttempt)) {
          resolvedPath = indexAttempt;
        } else if (fs.existsSync(htmlAttempt)) {
          resolvedPath = htmlAttempt;
        } else {
          resolvedPath = path.join(webDistDir, '404.html');
        }
      }

      if (!fs.existsSync(resolvedPath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const stat = fs.statSync(resolvedPath);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': stat.size,
      });
      fs.createReadStream(resolvedPath).pipe(res);
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: { code: 'ERR_LOCAL_SERVER', message: err instanceof Error ? err.message : String(err) },
      });
    }
  });
}

let mainWindow: BrowserWindow | null = null;
let localPort = 0;

function registerIpcHandlers(): void {
  ipcMain.handle('muxaro:has-ffmpeg', async () => Boolean(resolveBundledOrSystemBinary('ffmpeg')));
  ipcMain.handle('muxaro:has-ytdlp', async () => Boolean(resolveBundledOrSystemBinary('yt-dlp')));

  ipcMain.handle('muxaro:probe-url', async (_ev, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string') throw new Error('Invalid URL');
    return runYtdlpProbe(rawUrl);
  });

  ipcMain.handle(
    'muxaro:download-local',
    async (_ev, opts: { url: string; formatId?: string; mode?: string; quality?: string }) => {
      if (!opts || typeof opts.url !== 'string') {
        return { ok: false, error: 'Missing media URL' };
      }
      const job = startLocalProcessingJob({
        sourceUrl: opts.url,
        formatId: opts.formatId,
        mode: opts.mode,
        quality: opts.quality,
      });
      return { ok: true, jobId: job.id };
    }
  );

  ipcMain.handle(
    'muxaro:save-blob',
    async (_ev, opts: { filename: string; mimeType: string; bytes: Uint8Array }) => {
      try {
        const cleanName = sanitizeFileName(String(opts.filename || 'muxaro-export.bin'));
        const defaultPath = path.join(getUserMuxaroDownloadsDir(), cleanName);
        const result = await dialog.showSaveDialog(mainWindow!, {
          title: 'Save MUXARO Output',
          defaultPath,
        });
        if (result.canceled || !result.filePath) {
          return { ok: false, canceled: true };
        }
        fs.writeFileSync(result.filePath, Buffer.from(opts.bytes));
        return { ok: true, savedPath: result.filePath };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle('muxaro:open-downloads', async () => {
    await shell.openPath(getUserMuxaroDownloadsDir());
  });

  ipcMain.handle('muxaro:capture-screen', async () => {
    try {
      const display = screen.getPrimaryDisplay();
      const { width, height } = display.size;
      const scale = display.scaleFactor || 1;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.min(2560, Math.round(width * scale)),
          height: Math.min(1440, Math.round(height * scale)),
        },
      });
      if (!sources.length) {
        return { ok: false, error: 'No display source available.' };
      }
      const pngBuf = sources[0].thumbnail.toPNG();
      return { ok: true, bytes: new Uint8Array(pngBuf) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

async function bootDesktopApp(): Promise<void> {
  const webDistDir = path.resolve(__dirname, '..', 'web-dist');
  const server = createLocalServer(webDistDir);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        localPort = addr.port;
        process.env.MUXARO_DESKTOP_PORT = String(localPort);
      }
      resolve();
    });
  });

  registerIpcHandlers();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 680,
    title: 'MUXARO Studio',
    backgroundColor: '#0B0C0F',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(`http://127.0.0.1:${localPort}`)) {
      event.preventDefault();
      if (targetUrl.startsWith('https://')) {
        void shell.openExternal(targetUrl);
      }
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${localPort}/app/`);
}

app.whenReady().then(() => {
  void bootDesktopApp();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void bootDesktopApp();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
