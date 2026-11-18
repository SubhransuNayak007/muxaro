/**
 * MUXARO Media Processing Engine - Media Metadata Types
 */

export type ResolutionTier = '8K' | '4K' | '1440p' | '1080p' | '720p' | '480p' | '360p' | 'UNKNOWN';

export interface RawFFprobeDisposition {
  default?: number;
  dub?: number;
  original?: number;
  comment?: number;
  lyrics?: number;
  karaoke?: number;
  forced?: number;
  hearing_impaired?: number;
  visual_impaired?: number;
  clean_effects?: number;
  attached_pic?: number;
  timed_thumbnails?: number;
  [key: string]: number | undefined;
}

export interface RawFFprobeStream {
  index: number;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  codec_type?: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment';
  codec_tag_string?: string;
  codec_tag?: string;
  width?: number;
  height?: number;
  coded_width?: number;
  coded_height?: number;
  sample_aspect_ratio?: string;
  display_aspect_ratio?: string;
  pix_fmt?: string;
  level?: number;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  field_order?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  time_base?: string;
  start_pts?: number;
  start_time?: string;
  duration_ts?: number;
  duration?: string;
  bit_rate?: string;
  max_bit_rate?: string;
  bits_per_raw_sample?: string;
  nb_frames?: string;
  sample_fmt?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  bits_per_sample?: number;
  disposition?: RawFFprobeDisposition;
  tags?: Record<string, string>;
  [key: string]: unknown;
}

export interface RawFFprobeFormat {
  filename?: string;
  nb_streams?: number;
  nb_programs?: number;
  format_name?: string;
  format_long_name?: string;
  start_time?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
  probe_score?: number;
  tags?: Record<string, string>;
  [key: string]: unknown;
}

export interface RawFFprobeOutput {
  streams?: RawFFprobeStream[];
  format?: RawFFprobeFormat;
  error?: {
    code: number;
    string: string;
  };
}

export interface VideoStreamInfo {
  index: number;
  codec: string;
  codecLongName: string;
  profile?: string;
  width: number;
  height: number;
  resolutionTier: ResolutionTier;
  aspectRatio: string;
  frameRate: string;
  fps: number;
  bitrateKbps?: number;
  pixelFormat?: string;
  colorSpace?: string;
  colorPrimaries?: string;
  colorTransfer?: string;
  isHdr: boolean;
  durationSeconds: number;
  framesCount?: number;
}

export interface AudioStreamInfo {
  index: number;
  codec: string;
  codecLongName: string;
  profile?: string;
  channels: number;
  channelLayout: string;
  sampleRate: number;
  sampleFormat?: string;
  bitrateKbps?: number;
  durationSeconds: number;
  isLossless: boolean;
}

export interface MediaContainerInfo {
  formatName: string;
  formatLongName: string;
  durationSeconds: number;
  sizeBytes: number;
  overallBitrateKbps?: number;
  tags: Record<string, string>;
}

export interface MediaMetadata {
  container: MediaContainerInfo;
  hasVideo: boolean;
  hasAudio: boolean;
  videoStreams: VideoStreamInfo[];
  audioStreams: AudioStreamInfo[];
  primaryVideoStream?: VideoStreamInfo;
  primaryAudioStream?: AudioStreamInfo;
  trueResolutionTier: ResolutionTier;
  isHdr: boolean;
  integrity: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}
