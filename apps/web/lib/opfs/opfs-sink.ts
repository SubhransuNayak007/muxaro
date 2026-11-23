/**
 * MUXARO Stream Engine - OPFS Stream Sink Adapter
 * apps/web/lib/opfs/opfs-sink.ts
 *
 * Implements the StreamSink contract using OPFSStreamWriter.
 * Enables StreamMuxerEngine to stream 4K/8K fMP4 and WebM fragments directly
 * into browser Origin Private File System with flat < 32MB RAM usage,
 * and automatically triggers zero-RAM export to user disk upon stream completion.
 */

import type { StreamSink, SinkType } from '../stream-engine/types.ts';
import { OPFSStreamWriter } from './opfs-writer.ts';
import type { ExportToDiskOptions, OPFSExportResult } from './types.ts';

export class OPFSStreamSink implements StreamSink {
  public type: SinkType = 'opfs';
  private writer: OPFSStreamWriter | null = null;
  private filename: string = 'download.mp4';
  private mimeType: string = 'video/mp4';
  private downloadUrl?: string;
  private exportResult?: OPFSExportResult;
  private exportOptions?: ExportToDiskOptions;

  constructor(exportOptions?: ExportToDiskOptions) {
    this.exportOptions = exportOptions;
  }

  public async init(filename: string, mimeType: string, expectedSize?: number): Promise<void> {
    this.filename = filename;
    this.mimeType = mimeType;

    this.writer = new OPFSStreamWriter({
      fileName: filename,
      mimeType,
      expectedSize,
      allowFallback: true,
    });

    await this.writer.init();
  }

  public async write(chunk: Uint8Array): Promise<void> {
    if (!this.writer) {
      throw new Error('OPFSStreamSink is not initialized');
    }
    await this.writer.write(chunk);
  }

  public async close(): Promise<void> {
    if (!this.writer) return;

    await this.writer.close();

    // Trigger two-phase export directly to user disk
    try {
      this.exportResult = await this.writer.exportToDisk({
        suggestedName: this.filename,
        preferredMode: this.exportOptions?.preferredMode,
        onProgress: this.exportOptions?.onProgress,
        cleanupAfterExport: this.exportOptions?.cleanupAfterExport ?? true,
      });

      this.downloadUrl = this.exportResult.downloadUrl;
    } catch (err: any) {
      if (err?.code === 'ABORTED' || err?.name === 'AbortError') {
        // User cancelled destination picker; retain file in OPFS so user can retry export
        console.info('[MUXARO] User dismissed file picker; media retained in OPFS sandbox');
        return;
      }
      console.warn('[MUXARO] Failed auto-exporting OPFS stream to disk:', err);
    }
  }

  public async abort(reason?: unknown): Promise<void> {
    if (this.writer) {
      await this.writer.abort(String(reason || 'Sink aborted'));
      this.writer = null;
    }
  }

  public getBytesWritten(): number {
    return this.writer ? this.writer.bytesWritten : 0;
  }

  public getDownloadUrl(): string | undefined {
    return this.downloadUrl;
  }

  public getExportResult(): OPFSExportResult | undefined {
    return this.exportResult;
  }

  public async getFile(): Promise<File | Blob | null> {
    return this.writer ? await this.writer.getFile() : null;
  }
}
