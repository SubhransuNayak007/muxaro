/**
 * MUXARO 5-Stage Zero-Wait Pipelined Stream-Muxer Engine - Main Orchestrator
 * apps/web/lib/stream-engine/engine.ts
 *
 * Fully integrated browser-native media streaming orchestrator:
 * Stage 1: Speculative Paste-Time Warmup
 * Stage 2: Congestion-Aware Parallel Range Pipelining (AIMD 4->8, 512KB-8MB chunks, 32MB RingBuffer)
 * Stage 3: Real-Time Interleaved Remuxing (fMP4 & WebM/MKV with 0s merge wait)
 * Stage 4: Zero-RAM Direct-to-Disk Streaming (FileSystemAccess or ServiceWorker)
 * Stage 5: Hardware GPU Transcoding (WebCodecs)
 */

import { warmupStream, getWarmupSession } from './warmup.ts';
import { ParallelRangePipeline } from './range-pipeline.ts';
import { StreamingRemuxer } from './muxer.ts';
import { createOptimalSink } from './sink.ts';
import { HardwareGpuTranscoder, isWebCodecsSupported } from './webcodecs-transcoder.ts';
import { FFmpegWorkerClient } from '../ffmpeg/ffmpeg-client.ts';
import type { FFmpegTaskResult } from '../ffmpeg/types.ts';
import { spliceDashStreams } from '../media-splicer/index.ts';
import type {
  StreamEngineOptions,
  StreamPipelineController,
  StreamProgress,
  StreamStats,
  StreamResult,
  StreamStage,
  StreamSink,
} from './types.ts';

export type ZeroWaitStreamController = StreamPipelineController & {
  completion: Promise<StreamResult>;
};

type DetectedStreamKind = 'fmp4' | 'webm' | 'elementary' | 'unknown';

const MP4_BOX_TAGS = new Set(['ftyp', 'moov', 'sidx', 'styp', 'moof', 'emsg', 'mdat', 'free', 'skip']);

function detectKindFromBytes(bytes?: Uint8Array | null): DetectedStreamKind {
  if (!bytes || bytes.byteLength < 4) return 'unknown';

  // EBML header (WebM / Matroska): 0x1A 0x45 0xDF 0xA3 or Cluster 0x1F 0x43 0xB6 0x75
  if (
    (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) ||
    (bytes[0] === 0x1f && bytes[1] === 0x43 && bytes[2] === 0xb6 && bytes[3] === 0x75)
  ) {
    return 'webm';
  }

  // ISO BMFF / fMP4 box tag at bytes 4..7
  if (bytes.byteLength >= 8) {
    const boxTag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (MP4_BOX_TAGS.has(boxTag)) {
      return 'fmp4';
    }
  }

  // H.264 Annex-B start code
  if (
    (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01) ||
    (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x01)
  ) {
    return 'elementary';
  }

  // AAC ADTS syncword 0xFFF
  if (bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0) {
    return 'elementary';
  }

  return 'unknown';
}

function detectKindFromMetadata(contentType?: string, url?: string): DetectedStreamKind {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('webm') || ct.includes('matroska')) return 'webm';
  if (ct.includes('mp4') || ct.includes('m4s') || ct.includes('m4a')) return 'fmp4';

  const rawUrl = (url || '').toLowerCase();
  if (
    rawUrl.includes('mime=video%2fwebm') ||
    rawUrl.includes('mime=audio%2fwebm') ||
    rawUrl.includes('mime=video/webm') ||
    rawUrl.includes('mime=audio/webm') ||
    /\.(webm|mkv)(\?|$)/i.test(rawUrl)
  ) {
    return 'webm';
  }
  if (
    rawUrl.includes('mime=video%2fmp4') ||
    rawUrl.includes('mime=audio%2fmp4') ||
    rawUrl.includes('mime=video/mp4') ||
    rawUrl.includes('mime=audio/mp4') ||
    /\.(mp4|m4s|m4a|m4v)(\?|$)/i.test(rawUrl)
  ) {
    return 'fmp4';
  }
  if (/\.(h264|264|aac|adts)(\?|$)/i.test(rawUrl)) {
    return 'elementary';
  }
  return 'unknown';
}

async function probeStreamBytes(
  url: string,
  signal: AbortSignal
): Promise<{ bytes: Uint8Array | null; contentType?: string }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-63' },
      signal,
    });
    if (!res.ok) return { bytes: null };
    const contentType = res.headers.get('content-type') || undefined;
    if (res.status === 206) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return { bytes: buf.subarray(0, 64), contentType };
    }
    const reader = res.body?.getReader();
    if (!reader) return { bytes: null, contentType };
    try {
      const { value } = await reader.read();
      await reader.cancel().catch(() => {});
      return { bytes: value ? value.subarray(0, 64) : null, contentType };
    } catch {
      await reader.cancel().catch(() => {});
      return { bytes: null, contentType };
    }
  } catch {
    return { bytes: null };
  }
}

export class StreamMuxerEngine implements StreamPipelineController {
  private options: StreamEngineOptions;
  private stage: StreamStage = 'idle';

  private sink: StreamSink | null = null;
  private remuxer: StreamingRemuxer | null = null;
  private transcoder: HardwareGpuTranscoder | null = null;
  private videoPipeline: ParallelRangePipeline | null = null;
  private audioPipeline: ParallelRangePipeline | null = null;

  private startTime: number = 0;
  private downloadedBytes: number = 0;
  private totalExpectedBytes: number = 0;
  private peakSpeedBytesPerSec: number = 0;

  private isPaused: boolean = false;
  private isAborted: boolean = false;
  private abortController: AbortController;

  constructor(options: StreamEngineOptions) {
    this.options = options;
    this.abortController = new AbortController();

    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', () => {
        this.abort('External abort signal triggered');
      });
    }

    this.totalExpectedBytes =
      options.totalSizeBytes ||
      (options.videoSizeBytes || 0) + (options.audioSizeBytes || 0) ||
      0;
  }

  public getProgress(): StreamProgress {
    const downloaded = this.downloadedBytes;
    const total = this.totalExpectedBytes;
    const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;

    const elapsedSec = (performance.now() - (this.startTime || performance.now())) / 1000;
    const speed = elapsedSec > 0.2 ? Math.round(downloaded / elapsedSec) : 0;
    const remainingBytes = Math.max(0, total - downloaded);
    const etaSeconds = speed > 0 ? Math.round(remainingBytes / speed) : 0;

    const concurrency = this.videoPipeline?.getActiveConcurrency() || 4;
    const chunkSize = this.videoPipeline?.getCurrentChunkSize() || 1024 * 1024;
    const buffered =
      (this.videoPipeline?.getRingBuffer().getBufferedBytes() || 0) +
      (this.audioPipeline?.getRingBuffer().getBufferedBytes() || 0);

    const fragments = this.remuxer?.getFragmentsCount() || 0;
    const zeroWaitReady = percent >= 99 || this.stage === 'finalizing' || this.stage === 'completed';

    let message = 'Preparing stream...';
    if (this.stage === 'warmup') message = 'Warming up connection & fetching init segments...';
    else if (this.stage === 'connecting') message = 'Negotiating direct stream channels...';
    else if (this.stage === 'pipelining') {
      message = `Streaming direct to disk (${concurrency}x parallel pipelines, ${Math.round(chunkSize / 1024)}KB chunks)...`;
    } else if (this.stage === 'transcoding') {
      message = 'GPU Hardware Transcoding in progress...';
    } else if (this.stage === 'finalizing') {
      message = 'Finalizing container with 0-second merge wait...';
    } else if (this.stage === 'completed') {
      message = 'Stream download completed directly to disk!';
    } else if (this.stage === 'failed') {
      message = 'Stream encounter an error.';
    }

    return {
      stage: this.stage,
      percent,
      downloadedBytes: downloaded,
      totalBytes: total,
      speedBytesPerSec: speed,
      etaSeconds,
      activeConcurrency: concurrency,
      currentChunkSizeBytes: chunkSize,
      bufferedBytes: buffered,
      fragmentsMuxed: fragments,
      transcodedFrames: this.transcoder?.getFramesTranscoded(),
      zeroWaitReady,
      message,
    };
  }

  public getStats(): StreamStats {
    const durationMs = performance.now() - (this.startTime || performance.now());
    const downloaded = this.downloadedBytes;
    const averageSpeed = durationMs > 0 ? (downloaded / durationMs) * 1000 : 0;

    return {
      bytesDownloaded: downloaded,
      bytesWritten: this.sink?.getBytesWritten() || 0,
      totalBytesExpected: this.totalExpectedBytes,
      startTime: this.startTime,
      durationMs: Math.round(durationMs),
      averageSpeedBytesPerSec: Math.round(averageSpeed),
      peakSpeedBytesPerSec: Math.round(this.peakSpeedBytesPerSec),
      chunkCount:
        (this.videoPipeline?.getRingBuffer().getNextExpectedIndex() || 0) +
        (this.audioPipeline?.getRingBuffer().getNextExpectedIndex() || 0),
      fragmentsCount: this.remuxer?.getFragmentsCount() || 0,
      concurrencyLevel: this.videoPipeline?.getActiveConcurrency() || 4,
      currentChunkSize: this.videoPipeline?.getCurrentChunkSize() || 1024 * 1024,
      sinkType: this.sink?.type || 'file-system',
    };
  }

  public pause(): void {
    if (this.isPaused || this.isAborted) return;
    this.isPaused = true;
    this.videoPipeline?.pause();
    this.audioPipeline?.pause();
  }

  public resume(): void {
    if (!this.isPaused || this.isAborted) return;
    this.isPaused = false;
    this.videoPipeline?.resume();
    this.audioPipeline?.resume();
  }

  public abort(reason?: string): void {
    if (this.isAborted) return;
    this.isAborted = true;
    this.stage = 'cancelled';
    this.abortController.abort(reason);
    this.sink?.abort(reason);
    this.transcoder?.close();
  }

  private setStage(stage: StreamStage, details?: string): void {
    this.stage = stage;
    this.options.onStageChange?.(stage, details);
    this.notifyProgress();
  }

  private notifyProgress(): void {
    const progress = this.getProgress();
    if (progress.speedBytesPerSec > this.peakSpeedBytesPerSec) {
      this.peakSpeedBytesPerSec = progress.speedBytesPerSec;
    }
    this.options.onProgress?.(progress);
  }

  /**
   * Executes the full 5-stage streaming pipeline
   */
  public async run(): Promise<StreamResult> {
    this.startTime = performance.now();

    try {
      // ----------------------------------------------------
      // Stage 1: Speculative Paste-Time Warmup
      // ----------------------------------------------------
      this.setStage('warmup');
      let warmupSession = this.options.warmupSession || getWarmupSession(this.options.sourceUrl);
      if (!warmupSession) {
        warmupSession = await warmupStream(this.options.sourceUrl, {
          videoUrl: this.options.videoUrl,
          audioUrl: this.options.audioUrl,
        });
      }

      if (warmupSession.contentLength && this.totalExpectedBytes === 0) {
        this.totalExpectedBytes = warmupSession.contentLength;
      }

      // ----------------------------------------------------
      // Stage 4: Initialize Zero-RAM Direct-to-Disk Sink
      // ----------------------------------------------------
      this.setStage('connecting');
      const filename = this.options.filename || `muxaro-stream-${Date.now()}.${this.options.format || 'mp4'}`;
      const mimeType = this.options.format === 'webm' ? 'video/webm' : 'video/mp4';

      this.sink = await createOptimalSink(
        filename,
        mimeType,
        this.totalExpectedBytes,
        this.options.preferredSink
      );

      const isWebpage = (u?: string) =>
        Boolean(u && /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|twitter\.com|x\.com|pin\.it|pinterest\.com)\//i.test(u));

      let videoTargetUrl = this.options.videoUrl || this.options.sourceUrl;
      if (isWebpage(videoTargetUrl)) {
        if (this.options.videoUrl && !isWebpage(this.options.videoUrl)) {
          videoTargetUrl = this.options.videoUrl;
        } else {
          throw new Error('Direct stream requires an authorized stream endpoint. Webpage URLs cannot be queried directly with byte ranges.');
        }
      }
      const audioTargetUrl = this.options.audioUrl;

      const needsTranscode =
        this.options.forceTranscode === true ||
        (this.options.videoCodec && this.options.videoCodec !== 'copy') ||
        (this.options.audioCodec && this.options.audioCodec !== 'copy');

      // Inspect warmup magic bytes / contentType first; probe initial bytes if still unknown
      let videoKind = detectKindFromBytes(warmupSession.videoInitSegment || warmupSession.initSegment);
      let probedContentType = warmupSession.contentType;
      if (videoKind === 'unknown') {
        videoKind = detectKindFromMetadata(probedContentType, videoTargetUrl);
      }
      if (videoKind === 'unknown' && typeof fetch === 'function') {
        const probe = await probeStreamBytes(videoTargetUrl, this.abortController.signal);
        probedContentType = probe.contentType || probedContentType;
        videoKind = detectKindFromBytes(probe.bytes);
        if (videoKind === 'unknown') {
          videoKind = detectKindFromMetadata(probedContentType, videoTargetUrl);
        }
      }

      let audioKind: DetectedStreamKind = 'unknown';
      if (audioTargetUrl) {
        audioKind = detectKindFromBytes(warmupSession.audioInitSegment);
        if (audioKind === 'unknown') {
          audioKind = detectKindFromMetadata(undefined, audioTargetUrl);
        }
        if (audioKind === 'unknown' && videoKind !== 'elementary' && typeof fetch === 'function') {
          const audioProbe = await probeStreamBytes(audioTargetUrl, this.abortController.signal);
          audioKind = detectKindFromBytes(audioProbe.bytes);
          if (audioKind === 'unknown') {
            audioKind = detectKindFromMetadata(audioProbe.contentType, audioTargetUrl);
          }
        }
      }

      const isContainerizedDash =
        videoKind === 'fmp4' ||
        videoKind === 'webm' ||
        audioKind === 'fmp4' ||
        audioKind === 'webm' ||
        (Boolean(audioTargetUrl) && videoKind !== 'elementary' && audioKind !== 'elementary');

      let finalDownloadUrl: string | undefined;

      if (isContainerizedDash) {
        // ----------------------------------------------------
        // DASH Containerized Path:
        // Zero-Copy DashBoxSplicer (constant <=32MB RAM, 0s merge wait) when stream-copying,
        // falling back to FFmpegWorkerClient only if transcoding is requested or splicing fails.
        // ----------------------------------------------------
        this.setStage('pipelining');

        const targetFormat = (this.options.format || 'mp4').toLowerCase();
        const sameFamilyDash =
          !needsTranscode &&
          targetFormat !== 'mp3' &&
          (!audioTargetUrl || videoKind === audioKind || (videoKind !== 'unknown' && audioKind === 'unknown'));

        let splicedDirectly = false;
        if (sameFamilyDash) {
          try {
            let videoBytesCount = 0;
            let audioBytesCount = 0;
            const updateTrackBytes = (role: 'video' | 'audio', bytes: number) => {
              if (role === 'video') videoBytesCount = bytes;
              else audioBytesCount = bytes;
              this.downloadedBytes = videoBytesCount + audioBytesCount;
              this.notifyProgress();
            };

            const streamTrackIterable = (
              url: string,
              totalBytes: number | undefined,
              role: 'video' | 'audio'
            ): AsyncIterable<Uint8Array> => {
              const pipeline = new ParallelRangePipeline({
                url,
                totalBytes,
                initialChunkSize: role === 'audio' ? 512 * 1024 : this.options.initialChunkSize,
                initialConcurrency: role === 'audio' ? 2 : this.options.initialConcurrency,
                maxBufferBytes: role === 'audio' ? 8 * 1024 * 1024 : (this.options.maxBufferBytes || 16 * 1024 * 1024),
                streamType: role,
                signal: this.abortController.signal,
                onProgress: (p) => updateTrackBytes(role, p.downloadedBytes || 0),
              });
              if (role === 'video') this.videoPipeline = pipeline;
              else this.audioPipeline = pipeline;

              return {
                [Symbol.asyncIterator]: () => {
                  const startPromise = pipeline.start();
                  startPromise.catch(() => {});
                  const ring = pipeline.getRingBuffer();
                  let finished = false;
                  return {
                    async next() {
                      if (finished) return { value: undefined as any, done: true };
                      const chunk = await ring.popNextOrderedChunk();
                      if (!chunk) {
                        finished = true;
                        await startPromise;
                        return { value: undefined as any, done: true };
                      }
                      return { value: chunk.data, done: false };
                    },
                  };
                },
              };
            };

            const videoIter = streamTrackIterable(
              videoTargetUrl,
              this.options.videoSizeBytes || (!audioTargetUrl ? this.totalExpectedBytes : undefined),
              'video'
            );
            const audioIter = audioTargetUrl
              ? streamTrackIterable(audioTargetUrl, this.options.audioSizeBytes, 'audio')
              : null;

            await spliceDashStreams({
              videoChunks: videoIter,
              audioChunks: audioIter,
              containerHint: videoKind === 'webm' ? 'webm' : 'isom',
              signal: this.abortController.signal,
              sink: {
                write: (chunk) => this.sink!.write(chunk),
                close: () => this.sink!.close(),
              },
            });

            finalDownloadUrl = this.sink.getDownloadUrl?.();
            splicedDirectly = true;
          } catch (spliceErr) {
            if (this.abortController.signal.aborted) throw spliceErr;
            console.warn('[StreamEngine] DashBoxSplicer failed, falling back to FFmpegWorkerClient:', spliceErr);
          }
        }

        if (!splicedDirectly) {
          const videoExt = videoKind === 'webm' ? 'webm' : 'mp4';
          const audioExt = audioKind === 'webm' ? 'webm' : 'm4a';
          const videoMime = videoExt === 'webm' ? 'video/webm' : 'video/mp4';
          const audioMime = audioExt === 'webm' ? 'audio/webm' : 'audio/mp4';

          let videoBytesCount = 0;
          let audioBytesCount = 0;
          const updateTrackBytes = (role: 'video' | 'audio', bytes: number) => {
            if (role === 'video') videoBytesCount = bytes;
            else audioBytesCount = bytes;
            this.downloadedBytes = videoBytesCount + audioBytesCount;
            this.notifyProgress();
          };

          const downloadVideoPromise = this.downloadTrackBlob(
            videoTargetUrl,
            this.options.videoSizeBytes || (!audioTargetUrl ? this.totalExpectedBytes : undefined),
            'video',
            videoMime,
            (b) => updateTrackBytes('video', b)
          );

          const downloadAudioPromise = audioTargetUrl
            ? this.downloadTrackBlob(
                audioTargetUrl,
                this.options.audioSizeBytes,
                'audio',
                audioMime,
                (b) => updateTrackBytes('audio', b)
              )
            : Promise.resolve<Blob | null>(null);

          const [videoBlob, audioBlob] = await Promise.all([downloadVideoPromise, downloadAudioPromise]);

          if (this.abortController.signal.aborted) {
            throw new Error('Stream aborted');
          }

          this.setStage('finalizing');

          const ffmpegClient = FFmpegWorkerClient.getInstance();
          const muxContainer = targetFormat === 'webm' ? 'webm' : 'mp4';

          let workerResult: FFmpegTaskResult;
          if (audioBlob) {
            workerResult = await ffmpegClient.merge({
              videoFile: videoBlob,
              videoFileName: `track_video.${videoExt}`,
              audioFile: audioBlob,
              audioFileName: `track_audio.${audioExt}`,
              targetContainer: muxContainer,
              streamCopy: !needsTranscode,
              signal: this.abortController.signal,
              onProgress: () => this.notifyProgress(),
            });
          } else if (targetFormat === 'mp3') {
            workerResult = await ffmpegClient.extractAudio({
              file: videoBlob,
              fileName: `track_input.${videoExt}`,
              targetFormat: 'mp3',
              streamCopy: false,
              signal: this.abortController.signal,
              onProgress: () => this.notifyProgress(),
            });
          } else {
            workerResult = await ffmpegClient.convert({
              file: videoBlob,
              fileName: `track_input.${videoExt}`,
              targetContainer: muxContainer,
              streamCopy: !needsTranscode,
              videoCodec: this.options.videoCodec,
              audioCodec: this.options.audioCodec,
              signal: this.abortController.signal,
              onProgress: () => this.notifyProgress(),
            });
          }

          const outBlob = workerResult.blob;
          this.totalExpectedBytes = outBlob.size || this.totalExpectedBytes;
          const WRITE_CHUNK_BYTES = 2 * 1024 * 1024;
          for (let offset = 0; offset < outBlob.size; offset += WRITE_CHUNK_BYTES) {
            if (this.abortController.signal.aborted) {
              throw new Error('Stream aborted');
            }
            const slice = outBlob.slice(offset, Math.min(offset + WRITE_CHUNK_BYTES, outBlob.size));
            const chunkBuf = new Uint8Array(await slice.arrayBuffer());
            await this.sink.write(chunkBuf);
          }

          await this.sink.close();
          const sinkUrl = this.sink.getDownloadUrl?.();
          if (sinkUrl && workerResult.url) {
            try {
              URL.revokeObjectURL(workerResult.url);
            } catch {
              // Ignored
            }
          }
          finalDownloadUrl = sinkUrl || workerResult.url;
        }
      } else {
        // ----------------------------------------------------
        // Elementary Stream Path: Stage 3 StreamingRemuxer + Stage 5 WebCodecs
        // ----------------------------------------------------
        this.remuxer = new StreamingRemuxer({
          format: this.options.format || 'mp4',
          sink: this.sink,
          onFragmentMuxed: () => this.notifyProgress(),
        });

        if (needsTranscode && isWebCodecsSupported()) {
          this.setStage('transcoding');
          this.transcoder = new HardwareGpuTranscoder({
            targetVideoCodec: this.options.videoCodec,
            targetAudioCodec: this.options.audioCodec,
            onSampleReady: (sample) => this.remuxer?.pushSample(sample),
            onError: (err) => this.options.onError?.(err),
          });
        }

        this.setStage('pipelining');

        this.videoPipeline = new ParallelRangePipeline({
          url: videoTargetUrl,
          totalBytes: this.options.videoSizeBytes || this.totalExpectedBytes,
          initialChunkSize: this.options.initialChunkSize,
          initialConcurrency: this.options.initialConcurrency,
          maxBufferBytes: this.options.maxBufferBytes,
          streamType: audioTargetUrl ? 'video' : 'unified',
          signal: this.abortController.signal,
          onProgress: () => {
            this.downloadedBytes =
              (this.videoPipeline?.getDownloadedBytes() || 0) +
              (this.audioPipeline?.getDownloadedBytes() || 0);
            this.notifyProgress();
          },
        });

        if (audioTargetUrl) {
          this.audioPipeline = new ParallelRangePipeline({
            url: audioTargetUrl,
            totalBytes: this.options.audioSizeBytes,
            initialChunkSize: 512 * 1024,
            initialConcurrency: 2,
            maxBufferBytes: 8 * 1024 * 1024,
            streamType: 'audio',
            signal: this.abortController.signal,
            onProgress: () => {
              this.downloadedBytes =
                (this.videoPipeline?.getDownloadedBytes() || 0) +
                (this.audioPipeline?.getDownloadedBytes() || 0);
              this.notifyProgress();
            },
          });
        }

        const videoFetchPromise = this.videoPipeline.start();
        const audioFetchPromise = this.audioPipeline ? this.audioPipeline.start() : Promise.resolve();
        const consumerLoopPromise = this.consumeOrderedRingBuffer(audioTargetUrl !== undefined);

        await Promise.all([videoFetchPromise, audioFetchPromise, consumerLoopPromise]);

        this.setStage('finalizing');
        if (this.transcoder) {
          await this.transcoder.flush();
        }
        await this.remuxer.finalize();
        await this.sink.close();
        finalDownloadUrl = this.sink.getDownloadUrl?.();
      }

      this.setStage('completed');

      const result: StreamResult = {
        success: true,
        filename,
        totalBytes: this.sink.getBytesWritten(),
        durationMs: Math.round(performance.now() - this.startTime),
        sinkType: this.sink.type,
        averageSpeedBytesPerSec: this.getStats().averageSpeedBytesPerSec,
        savedToDiskDirectly: this.sink.type !== 'blob',
        downloadUrl: finalDownloadUrl,
      };

      this.options.onComplete?.(result);
      return result;
    } catch (err: any) {
      const normalizedErr = err instanceof Error ? err : new Error(String(err || 'Stream pipeline failed'));
      if (!this.isAborted) {
        try {
          this.setStage('failed');
        } catch {
          this.stage = 'failed';
        }
      }
      if (this.sink) {
        try {
          await this.sink.abort(normalizedErr);
        } catch {
          // Ignore sink abort errors
        }
      }
      try {
        this.options.onError?.(normalizedErr);
      } catch {
        // Ignore error callback failures
      }
      throw normalizedErr;
    }
  }

  private async downloadTrackBlob(
    url: string,
    totalBytes: number | undefined,
    role: 'video' | 'audio',
    mimeType: string,
    onBytesUpdated: (bytes: number) => void
  ): Promise<Blob> {
    const pipeline = new ParallelRangePipeline({
      url,
      totalBytes,
      initialChunkSize: role === 'audio' ? 512 * 1024 : this.options.initialChunkSize,
      initialConcurrency: role === 'audio' ? 2 : this.options.initialConcurrency,
      maxBufferBytes: role === 'audio' ? 8 * 1024 * 1024 : this.options.maxBufferBytes,
      streamType: role,
      signal: this.abortController.signal,
      onProgress: (p) => onBytesUpdated(p.downloadedBytes || 0),
    });

    if (role === 'video') {
      this.videoPipeline = pipeline;
    } else {
      this.audioPipeline = pipeline;
    }

    try {
      const chunks: Uint8Array[] = [];
      const drainRing = async () => {
        const ring = pipeline.getRingBuffer();
        while (!this.abortController.signal.aborted) {
          const chunk = await ring.popNextOrderedChunk(this.abortController.signal);
          if (!chunk) break;
          chunks.push(chunk.data);
        }
      };

      await Promise.all([pipeline.start(), drainRing()]);
      if (chunks.length > 0) {
        return new Blob(chunks as BlobPart[], { type: mimeType });
      }
    } catch (err) {
      if (this.abortController.signal.aborted) {
        throw err;
      }
      console.warn(`[StreamEngine] Parallel range track download failed for ${role}, falling back to streaming fetch:`, err);
    }

    // Fallback: direct streaming fetch when server rejects Range or omits Content-Length
    const res = await fetch(url, { signal: this.abortController.signal });
    if (!res.ok) {
      throw new Error(`Track download failed (${res.status} ${res.statusText})`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      const buf = new Uint8Array(await res.arrayBuffer());
      onBytesUpdated(buf.byteLength);
      return new Blob([buf as BlobPart], { type: mimeType });
    }

    const fallbackChunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      if (this.abortController.signal.aborted) {
        await reader.cancel().catch(() => {});
        throw new Error('Stream aborted');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        fallbackChunks.push(value);
        received += value.byteLength;
        onBytesUpdated(received);
      }
    }
    return new Blob(fallbackChunks as BlobPart[], { type: mimeType });
  }

  private async consumeOrderedRingBuffer(hasSeparateAudio: boolean): Promise<void> {
    const videoBuffer = this.videoPipeline!.getRingBuffer();
    const audioBuffer = this.audioPipeline?.getRingBuffer();

    const drainVideo = async () => {
      while (!this.abortController.signal.aborted) {
        const chunk = await videoBuffer.popNextOrderedChunk(this.abortController.signal);
        if (!chunk) break;
        await this.remuxer!.ingestStreamChunk(chunk.data, 'video');
      }
    };

    const drainAudio = async () => {
      if (!hasSeparateAudio || !audioBuffer) return;
      while (!this.abortController.signal.aborted) {
        const chunk = await audioBuffer.popNextOrderedChunk(this.abortController.signal);
        if (!chunk) break;
        await this.remuxer!.ingestStreamChunk(chunk.data, 'audio');
      }
    };

    await Promise.all([drainVideo(), drainAudio()]);
  }
}

/**
 * Top-level convenience runner
 */
export async function startZeroWaitStream(options: StreamEngineOptions): Promise<ZeroWaitStreamController> {
  let errorNotified = false;
  const notifyErrorOnce = (err: unknown) => {
    if (errorNotified) return;
    errorNotified = true;
    const normalized = err instanceof Error ? err : new Error(String(err || 'Stream pipeline failed'));
    try {
      options.onError?.(normalized);
    } catch {
      // Ignore error callback failure
    }
  };

  const engine = new StreamMuxerEngine({
    ...options,
    onError: notifyErrorOnce,
  });

  const completion = engine.run().catch((err) => {
    notifyErrorOnce(err);
    throw err;
  });
  // Prevent UnhandledPromiseRejection for callers that rely on options.onError only
  completion.catch(() => {});

  return Object.assign(engine, { completion });
}
