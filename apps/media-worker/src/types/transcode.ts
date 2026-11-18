/**
 * MUXARO Media Processing Engine - Processing Options & Event Types
 */

import { ResolutionTier, MediaMetadata } from './media.js';

export type VideoContainer = 'mp4' | 'mkv' | 'webm';
export type VideoCodecTarget = 'h264' | 'hevc' | 'vp9' | 'av1' | 'copy';
export type AudioContainer = 'mp3' | 'aac' | 'm4a' | 'flac' | 'wav' | 'opus' | 'ogg' | 'copy';
export type AudioCodecTarget = 'aac' | 'mp3' | 'opus' | 'flac' | 'pcm_s16le' | 'vorbis' | 'copy';

export interface ProgressEvent {
  jobId?: string;
  stage: 'probing' | 'transcoding' | 'remuxing' | 'extracting' | 'merging' | 'packaging' | 'verifying' | 'completed' | 'failed';
  percentage: number; // 0 to 100
  currentTimeSeconds: number;
  totalDurationSeconds: number;
  fps?: number;
  speed?: number; // e.g. 1.5x real-time
  currentFrame?: number;
  bitrateKbps?: number;
  etaSeconds?: number;
  message?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export interface VideoProcessingOptions {
  inputPath: string;
  outputPath: string;
  targetContainer: VideoContainer;
  targetResolution?: ResolutionTier;
  targetCodec?: VideoCodecTarget;
  crf?: number; // default: 20 for h264, 23 for hevc
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow';
  maxBitrateKbps?: number;
  audioCodec?: AudioCodecTarget;
  audioBitrateKbps?: number;
  timeoutMs?: number;
  onProgress?: ProgressCallback;
}

export interface AudioExtractionOptions {
  inputPath: string;
  outputPath: string;
  targetFormat: AudioContainer;
  targetCodec?: AudioCodecTarget;
  bitrateKbps?: number; // e.g. 320, 256, 192, 128
  sampleRate?: number; // e.g. 44100, 48000
  channels?: number; // 1 = mono, 2 = stereo
  timeoutMs?: number;
  onProgress?: ProgressCallback;
}

export interface AudioQualityHonestyReport {
  sourceCodec: string;
  sourceBitrateKbps?: number;
  sourceSampleRate: number;
  sourceIsLossless: boolean;
  targetCodec: string;
  targetFormat: AudioContainer;
  targetBitrateKbps?: number;
  targetIsLossless: boolean;
  isStreamCopy: boolean;
  isUpsampling: boolean;
  honestyVerdict: 'NATIVE_COPY' | 'TRANSPARENT_ENCODE' | 'LOSSY_TO_LOSSY_DEGRADATION' | 'FALSE_FIDELITY_UPSAMPLING';
  honestyExplanation: string;
}

export interface MergeOptions {
  videoInputPath: string;
  audioInputPath: string;
  outputPath: string;
  targetContainer?: VideoContainer;
  audioOffsetMs?: number; // Positive = audio delayed; Negative = audio advanced
  preferStreamCopy?: boolean; // Attempt -c:v copy -c:a copy if codecs are compatible
  timeoutMs?: number;
  onProgress?: ProgressCallback;
}

export interface BatchItem {
  filePath: string;
  entryName: string;
  title?: string;
  durationSeconds?: number;
  sizeBytes?: number;
}

export interface BatchPackagingOptions {
  items: BatchItem[];
  outputPath: string;
  archiveTitle?: string;
  playlistMetadata?: {
    id?: string;
    title?: string;
    sourceReference?: string;
    itemCount?: number;
  };
  timeoutMs?: number;
  onProgress?: (progress: { percentage: number; processedFiles: number; totalFiles: number; processedBytes: number }) => void;
}

export interface OutputVerificationResult {
  valid: boolean;
  outputPath: string;
  fileSizeBytes: number;
  durationSeconds: number;
  expectedDurationSeconds?: number;
  durationDeviationSeconds: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  resolutionTier?: ResolutionTier;
  width?: number;
  height?: number;
  errors: string[];
  warnings: string[];
}

export interface ProcessingResult {
  success: boolean;
  outputPath: string;
  actionTaken: 'STREAM_COPY' | 'TRANSCODE' | 'MERGE_STREAM_COPY' | 'MERGE_TRANSCODE' | 'AUDIO_STREAM_COPY' | 'AUDIO_TRANSCODE' | 'ZIP_PACKAGE';
  durationSeconds: number;
  fileSizeBytes: number;
  metadata?: MediaMetadata;
  verification: OutputVerificationResult;
  audioHonestyReport?: AudioQualityHonestyReport;
  processingTimeMs: number;
}
