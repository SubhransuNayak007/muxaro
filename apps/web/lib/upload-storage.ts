import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export function getUploadsDir(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || Boolean(process.env.LAMBDA_TASK_ROOT)) {
    const tmp = path.join(os.tmpdir(), 'muxaro-uploads');
    try {
      fs.mkdirSync(tmp, { recursive: true });
    } catch {}
    return tmp;
  }
  const localDir = path.resolve(process.cwd(), '.muxaro-uploads');
  try {
    fs.mkdirSync(localDir, { recursive: true });
  } catch {}
  return localDir;
}

export interface UploadSessionMeta {
  uploadId: string;
  originalFilename: string;
  safeFilename: string;
  totalSize: number;
  totalParts: number;
  expectedSha256?: string;
  sessionDir: string;
  createdAt: string;
  expiresAt: string;
}

function sessionMetaPath(sessionDir: string): string {
  return path.join(sessionDir, 'session.json');
}

export async function saveSessionMeta(meta: UploadSessionMeta): Promise<void> {
  await fsp.mkdir(meta.sessionDir, { recursive: true });
  await fsp.writeFile(sessionMetaPath(meta.sessionDir), JSON.stringify(meta, null, 2), 'utf8');
}

export async function getSessionMeta(uploadId: string): Promise<UploadSessionMeta | null> {
  const uploadsRoot = getUploadsDir();
  const sessionDir = path.join(uploadsRoot, 'multipart', uploadId);
  const p = sessionMetaPath(sessionDir);
  try {
    if (!fs.existsSync(p)) return null;
    const raw = await fsp.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function deleteUploadSession(uploadId: string): Promise<void> {
  const uploadsRoot = getUploadsDir();
  const sessionDir = path.join(uploadsRoot, 'multipart', uploadId);
  await fsp.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
}

export function sanitizeUploadFilename(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_');
  return clean || 'uploaded_media.mp4';
}
