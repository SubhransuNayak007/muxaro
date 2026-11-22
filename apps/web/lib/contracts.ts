/**
 * MUXARO Canonical Systems & API Contracts
 * Single source of truth for media extraction, job pipelines, and UI state.
 * Bound by Supreme Constitution Law 1 (Zero Hallucination) & Law 3 (Strict File Locking).
 */

export type SupportedPlatform =
  | 'youtube'
  | 'instagram'
  | 'x'
  | 'facebook'
  | 'pinterest'
  | 'tiktok'
  | 'reddit'
  | 'vimeo'
  | 'other';

export type MediaAssetType = 'video' | 'audio' | 'carousel' | 'playlist' | 'image';

export type TargetContainer = 'mp4' | 'mkv' | 'webm' | 'mp3' | 'flac' | 'wav' | 'm4a' | 'opus';

export interface VideoFormatOption {
  id: string;
  videoFormatId: string;
  pairedAudioFormatId?: string;
  label: string; // e.g. "8K Ultra HD", "4K (2160p)", "1080p Full HD"
  resolutionHeight: number; // 4320, 2160, 1440, 1080, 720, 480, 360
  width?: number;
  fps: number; // 60, 30, etc.
  vcodec: string; // e.g. "av01", "vp9", "h264"
  acodec?: string; // e.g. "aac", "opus"
  container: string; // source container e.g. "mp4", "webm"
  targetContainer: TargetContainer;
  isHdr: boolean;
  requiresMerge: boolean;
  estimatedBytes?: number;
  bitrateKbps?: number;
  badge?: string; // e.g. "Best Quality", "60fps", "HDR"
}

export interface AudioFormatOption {
  id: string;
  sourceAudioFormatId: string;
  label: string; // e.g. "MP3 320kbps", "FLAC Lossless", "Original M4A"
  format: 'mp3' | 'flac' | 'wav' | 'm4a' | 'opus';
  bitrateLabel: string; // e.g. "320 kbps", "Lossless", "192 kbps"
  estimatedBytes?: number;
}

export interface MediaEntry {
  index: number;
  id: string;
  title: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  url: string;
  type: 'video' | 'image' | 'audio';
}

export interface MediaAnalysisResult {
  id: string;
  platform: SupportedPlatform;
  mediaType: MediaAssetType;
  title: string;
  uploader: string;
  uploaderUrl?: string;
  durationSeconds: number | null;
  thumbnailUrl: string;
  originalUrl: string;
  maxResolutionLabel: string; // e.g. "8K (4320p)" or "4K (2160p)"
  videoFormats: VideoFormatOption[];
  audioFormats: AudioFormatOption[];
  entries?: MediaEntry[];
  warnings?: string[];
  analyzedAt: string;
}

export type JobStatus =
  | 'queued'
  | 'fetching_metadata'
  | 'downloading_video'
  | 'downloading_audio'
  | 'merging'
  | 'converting'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface DownloadJobState {
  jobId: string;
  status: JobStatus;
  progressPercent: number;
  stageLabel: string;
  speedBytesPerSec?: number;
  speedDisplay?: string;
  etaSeconds?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  filename?: string;
  mimeType?: string;
  finalSizeBytes?: number;
  downloadUrl?: string;
  expiresAt: string;
  error?: JobError;
  sourceUrl: string;
  targetResolution?: string;
  targetFormat?: string;
}

export interface SystemHealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  ytdlp: {
    available: boolean;
    version?: string;
  };
  ffmpeg: {
    available: boolean;
    version?: string;
  };
  ffprobe: {
    available: boolean;
    version?: string;
  };
  activeJobs: number;
  maxConcurrentJobs: number;
  checkedAt: string;
}
