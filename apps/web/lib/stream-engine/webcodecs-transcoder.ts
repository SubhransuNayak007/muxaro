/**
 * MUXARO Zero-Wait Pipelined Stream Engine - Stage 5: Hardware GPU Transcoding
 * apps/web/lib/stream-engine/webcodecs-transcoder.ts
 *
 * WebCodecs Hardware Acceleration Pipeline:
 * - On-device GPU hardware decode & encode via VideoDecoder and VideoEncoder
 * - 'prefer-hardware' acceleration for fast 60-120fps transcoding without CPU burn
 * - Feeds transcoded EncodedVideoChunks directly to Stage 3 Muxer
 */

import type { MediaSample, VideoCodec, AudioCodec, VideoTrackConfig, AudioTrackConfig } from './types.ts';

// Ambient declarations for WebCodecs types to ensure compatibility
interface VideoEncoderConfigLike {
  codec: string;
  width: number;
  height: number;
  bitrate?: number;
  framerate?: number;
  hardwareAcceleration?: 'prefer-hardware' | 'require-hardware' | 'no-preference';
  avc?: { format: 'avc' | 'annexb' };
}

interface VideoDecoderConfigLike {
  codec: string;
  codedWidth?: number;
  codedHeight?: number;
  description?: BufferSource;
  hardwareAcceleration?: 'prefer-hardware' | 'require-hardware' | 'no-preference';
}

/**
 * Checks if WebCodecs is available in the current browser environment
 */
export function isWebCodecsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).VideoEncoder !== 'undefined' &&
    typeof (window as any).VideoDecoder !== 'undefined'
  );
}

/**
 * Checks whether hardware acceleration is supported for a specific codec configuration
 */
export async function isHardwareCodecSupported(codec: string, width = 1920, height = 1080): Promise<boolean> {
  if (!isWebCodecsSupported()) return false;

  try {
    const VideoEncoderClass = (window as any).VideoEncoder;
    const support = await VideoEncoderClass.isConfigSupported({
      codec,
      width,
      height,
      bitrate: 5_000_000,
      framerate: 30,
      hardwareAcceleration: 'prefer-hardware',
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

export interface TranscoderOptions {
  targetVideoCodec?: VideoCodec;
  targetAudioCodec?: AudioCodec;
  width?: number;
  height?: number;
  bitrate?: number;
  framerate?: number;
  onSampleReady?: (sample: MediaSample) => void;
  onError?: (err: Error) => void;
}

export class HardwareGpuTranscoder {
  private options: TranscoderOptions;
  private videoDecoder: any = null;
  private videoEncoder: any = null;
  private audioDecoder: any = null;
  private audioEncoder: any = null;

  private isInitialized: boolean = false;
  private framesTranscoded: number = 0;
  private outputTrackConfig?: VideoTrackConfig;

  constructor(options: TranscoderOptions) {
    this.options = options;
  }

  public getFramesTranscoded(): number {
    return this.framesTranscoded;
  }

  public getOutputTrackConfig(): VideoTrackConfig | undefined {
    return this.outputTrackConfig;
  }

  /**
   * Initializes the hardware VideoEncoder and VideoDecoder
   */
  public async initVideoPipeline(inputConfig: VideoTrackConfig): Promise<void> {
    if (!isWebCodecsSupported()) {
      throw new Error('WebCodecs not supported in this browser');
    }

    const VideoEncoderClass = (window as any).VideoEncoder;
    const VideoDecoderClass = (window as any).VideoDecoder;

    const targetWidth = this.options.width || inputConfig.width || 1920;
    const targetHeight = this.options.height || inputConfig.height || 1080;
    const framerate = this.options.framerate || 30;
    const bitrate = this.options.bitrate || 6_000_000;

    let targetCodecString = 'avc1.640028'; // H.264 High Profile 4.0
    if (this.options.targetVideoCodec === 'vp9') {
      targetCodecString = 'vp09.00.10.08';
    } else if (this.options.targetVideoCodec === 'av1') {
      targetCodecString = 'av01.0.08M.10';
    }

    // 1. Setup VideoEncoder (Hardware Accelerated)
    this.videoEncoder = new VideoEncoderClass({
      output: (chunk: any, metadata: any) => {
        this.handleEncodedVideoChunk(chunk, metadata);
      },
      error: (err: any) => {
        console.error('[WebCodecs] Encoder error:', err);
        this.options.onError?.(err);
      },
    });

    const encoderConfig: VideoEncoderConfigLike = {
      codec: targetCodecString,
      width: targetWidth,
      height: targetHeight,
      bitrate,
      framerate,
      hardwareAcceleration: 'prefer-hardware',
      avc: { format: 'avc' },
    };

    await this.videoEncoder.configure(encoderConfig);

    // 2. Setup VideoDecoder
    this.videoDecoder = new VideoDecoderClass({
      output: (videoFrame: any) => {
        this.handleDecodedFrame(videoFrame);
      },
      error: (err: any) => {
        console.error('[WebCodecs] Decoder error:', err);
        this.options.onError?.(err);
      },
    });

    const decoderConfig: VideoDecoderConfigLike = {
      codec: inputConfig.codec || 'avc1.640028',
      codedWidth: inputConfig.width,
      codedHeight: inputConfig.height,
      description: inputConfig.sps as unknown as BufferSource | undefined,
      hardwareAcceleration: 'prefer-hardware',
    };

    this.videoDecoder.configure(decoderConfig);

    this.outputTrackConfig = {
      trackId: 1,
      codec: targetCodecString,
      width: targetWidth,
      height: targetHeight,
      timescale: 90000,
    };

    this.isInitialized = true;
  }

  private handleDecodedFrame(videoFrame: any): void {
    if (!this.videoEncoder) {
      videoFrame.close();
      return;
    }

    try {
      // Keyframe requested every 60 frames (~2 seconds)
      const isKeyframe = this.framesTranscoded % 60 === 0;
      this.videoEncoder.encode(videoFrame, { keyFrame: isKeyframe });
      this.framesTranscoded++;
    } finally {
      // Close decoded VideoFrame immediately to return GPU memory to pool
      videoFrame.close();
    }
  }

  private handleEncodedVideoChunk(chunk: any, metadata?: any): void {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);

    if (metadata && metadata.decoderConfig && metadata.decoderConfig.description) {
      const desc = new Uint8Array(metadata.decoderConfig.description);
      if (this.outputTrackConfig) {
        this.outputTrackConfig.sps = desc;
      }
    }

    const sample: MediaSample = {
      trackId: 1,
      type: 'video',
      data,
      pts: chunk.timestamp,
      dts: chunk.timestamp,
      duration: chunk.duration || 3000,
      isKeyframe: chunk.type === 'key',
      timescale: 90000,
    };

    this.options.onSampleReady?.(sample);
  }

  /**
   * Pushes a raw video sample into the hardware decoder
   */
  public async transcodeVideoSample(sample: MediaSample): Promise<void> {
    if (!this.videoDecoder || !this.isInitialized) return;

    const EncodedVideoChunkClass = (window as any).EncodedVideoChunk;
    const chunk = new EncodedVideoChunkClass({
      type: sample.isKeyframe ? 'key' : 'delta',
      timestamp: sample.pts,
      duration: sample.duration,
      data: sample.data,
    });

    this.videoDecoder.decode(chunk);
  }

  /**
   * Flushes decoder and encoder pipelines cleanly
   */
  public async flush(): Promise<void> {
    if (this.videoDecoder) {
      await this.videoDecoder.flush();
    }
    if (this.videoEncoder) {
      await this.videoEncoder.flush();
    }
  }

  public close(): void {
    try {
      this.videoDecoder?.close();
      this.videoEncoder?.close();
    } catch (_) {}
    this.videoDecoder = null;
    this.videoEncoder = null;
    this.isInitialized = false;
  }
}
