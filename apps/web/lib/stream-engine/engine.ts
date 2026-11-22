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
import type {
  StreamEngineOptions,
  StreamPipelineController,
  StreamProgress,
  StreamStats,
  StreamResult,
  StreamStage,
  StreamSink,
} from './types.ts';

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

      // ----------------------------------------------------
      // Stage 3: Real-Time Interleaved Remuxer
      // ----------------------------------------------------
      this.remuxer = new StreamingRemuxer({
        format: this.options.format || 'mp4',
        sink: this.sink,
        onFragmentMuxed: () => this.notifyProgress(),
      });

      // ----------------------------------------------------
      // Stage 5: Hardware GPU Transcoding via WebCodecs
      // ----------------------------------------------------
      const needsTranscode =
        this.options.forceTranscode === true ||
        (this.options.videoCodec && this.options.videoCodec !== 'copy') ||
        (this.options.audioCodec && this.options.audioCodec !== 'copy');

      if (needsTranscode && isWebCodecsSupported()) {
        this.setStage('transcoding');
        this.transcoder = new HardwareGpuTranscoder({
          targetVideoCodec: this.options.videoCodec,
          targetAudioCodec: this.options.audioCodec,
          onSampleReady: (sample) => this.remuxer?.pushSample(sample),
          onError: (err) => this.options.onError?.(err),
        });
      }

      // ----------------------------------------------------
      // Stage 2: Parallel Range Pipeline Execution
      // ----------------------------------------------------
      this.setStage('pipelining');

      const videoTargetUrl = this.options.videoUrl || this.options.sourceUrl;
      const audioTargetUrl = this.options.audioUrl;

      // Video pipeline
      this.videoPipeline = new ParallelRangePipeline({
        url: videoTargetUrl,
        totalBytes: this.options.videoSizeBytes || this.totalExpectedBytes,
        initialChunkSize: this.options.initialChunkSize,
        initialConcurrency: this.options.initialConcurrency,
        maxBufferBytes: this.options.maxBufferBytes,
        streamType: audioTargetUrl ? 'video' : 'unified',
        signal: this.abortController.signal,
        onProgress: (p) => {
          this.downloadedBytes = (this.videoPipeline?.getDownloadedBytes() || 0) +
            (this.audioPipeline?.getDownloadedBytes() || 0);
          this.notifyProgress();
        },
      });

      // Audio pipeline (if separate adaptive stream)
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
            this.downloadedBytes = (this.videoPipeline?.getDownloadedBytes() || 0) +
              (this.audioPipeline?.getDownloadedBytes() || 0);
            this.notifyProgress();
          },
        });
      }

      // Start pipelines concurrently
      const videoFetchPromise = this.videoPipeline.start();
      const audioFetchPromise = this.audioPipeline ? this.audioPipeline.start() : Promise.resolve();

      // Consumer loop: drains ordered chunks from RingBuffer to Remuxer in real time
      const consumerLoopPromise = this.consumeOrderedRingBuffer(audioTargetUrl !== undefined);

      await Promise.all([videoFetchPromise, audioFetchPromise, consumerLoopPromise]);

      // ----------------------------------------------------
      // Stage 3 & 4 Finalization: 0s Merge Wait!
      // ----------------------------------------------------
      this.setStage('finalizing');
      if (this.transcoder) {
        await this.transcoder.flush();
      }
      await this.remuxer.finalize();
      await this.sink.close();

      this.setStage('completed');

      const result: StreamResult = {
        success: true,
        filename,
        totalBytes: this.sink.getBytesWritten(),
        durationMs: Math.round(performance.now() - this.startTime),
        sinkType: this.sink.type,
        averageSpeedBytesPerSec: this.getStats().averageSpeedBytesPerSec,
        savedToDiskDirectly: this.sink.type !== 'blob',
        downloadUrl: this.sink.getDownloadUrl?.(),
      };

      this.options.onComplete?.(result);
      return result;
    } catch (err: any) {
      this.setStage('failed');
      if (this.sink) {
        await this.sink.abort(err);
      }
      this.options.onError?.(err);
      throw err;
    }
  }

  private async consumeOrderedRingBuffer(hasSeparateAudio: boolean): Promise<void> {
    const videoBuffer = this.videoPipeline!.getRingBuffer();
    const audioBuffer = this.audioPipeline?.getRingBuffer();

    let videoDone = false;
    let audioDone = !hasSeparateAudio;

    while ((!videoDone || !audioDone) && !this.abortController.signal.aborted) {
      if (!videoDone) {
        const chunk = await videoBuffer.popNextOrderedChunk(this.abortController.signal);
        if (chunk) {
          await this.remuxer!.ingestStreamChunk(chunk.data, 'video');
        } else {
          videoDone = true;
        }
      }

      if (audioBuffer && !audioDone) {
        const chunk = await audioBuffer.popNextOrderedChunk(this.abortController.signal);
        if (chunk) {
          await this.remuxer!.ingestStreamChunk(chunk.data, 'audio');
        } else {
          audioDone = true;
        }
      }
    }
  }
}

/**
 * Top-level convenience runner
 */
export async function startZeroWaitStream(options: StreamEngineOptions): Promise<StreamPipelineController> {
  const engine = new StreamMuxerEngine(options);
  // Start execution in background so controller is returned immediately
  setTimeout(() => {
    engine.run().catch((err) => {
      console.error('[StreamEngine] Pipeline error:', err);
    });
  }, 0);
  return engine;
}
