/**
 * MUXARO Media Processing Engine - Batch & Playlist Packager
 * Generates streaming ZIP archives for playlist downloads and batch jobs with progress reporting and manifest indexing.
 */

import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { ProcessSanitizer } from '../process/sanitizer.js';
import { BatchPackagingOptions, ProcessingResult } from '../types/transcode.js';

export class BatchPackager {
  /**
   * Packages multiple media files into a compressed ZIP archive.
   */
  public async packageZip(options: BatchPackagingOptions): Promise<ProcessingResult> {
    const startTime = Date.now();
    const validatedOutput = ProcessSanitizer.validatePath(options.outputPath);

    // Ensure output directory exists
    const outputDir = path.dirname(validatedOutput);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const items = options.items ?? [];
    if (items.length === 0) {
      throw new Error('Batch packaging requires at least one file item.');
    }

    // Verify all input files exist
    const verifiedItems: Array<{ filePath: string; entryName: string; sizeBytes: number }> = [];
    let totalInputBytes = 0;

    for (const item of items) {
      const validatedInput = ProcessSanitizer.validatePath(item.filePath);
      if (!fs.existsSync(validatedInput)) {
        throw new Error(`Batch item file not found: "${item.filePath}"`);
      }
      const stat = fs.statSync(validatedInput);
      const safeName = ProcessSanitizer.sanitizeFilename(item.entryName || path.basename(item.filePath));
      verifiedItems.push({
        filePath: validatedInput,
        entryName: safeName,
        sizeBytes: stat.size
      });
      totalInputBytes += stat.size;
    }

    return new Promise<ProcessingResult>((resolve, reject) => {
      const outputStream = fs.createWriteStream(validatedOutput);
      const archive = archiver('zip', {
        zlib: { level: 6 } // Balanced compression vs speed
      });

      let processedFiles = 0;
      let processedBytes = 0;

      outputStream.on('close', () => {
        const finalStat = fs.statSync(validatedOutput);
        options.onProgress?.({
          percentage: 100,
          processedFiles: verifiedItems.length,
          totalFiles: verifiedItems.length,
          processedBytes: finalStat.size
        });

        resolve({
          success: true,
          outputPath: validatedOutput,
          actionTaken: 'ZIP_PACKAGE',
          durationSeconds: 0,
          fileSizeBytes: finalStat.size,
          verification: {
            valid: finalStat.size > 0,
            outputPath: validatedOutput,
            fileSizeBytes: finalStat.size,
            durationSeconds: 0,
            durationDeviationSeconds: 0,
            hasVideo: false,
            hasAudio: false,
            errors: finalStat.size > 0 ? [] : ['ZIP file created but is 0 bytes.'],
            warnings: []
          },
          processingTimeMs: Date.now() - startTime
        });
      });

      archive.on('error', (err) => {
        reject(new Error(`ZIP archive packaging error: ${err.message}`));
      });

      archive.on('progress', (progress) => {
        processedBytes = progress.fs.processedBytes;
        const totalEstimate = totalInputBytes > 0 ? totalInputBytes : 1;
        const percentage = Math.min(99, Math.round((processedBytes / totalEstimate) * 100));

        options.onProgress?.({
          percentage,
          processedFiles,
          totalFiles: verifiedItems.length,
          processedBytes
        });
      });

      archive.on('entry', () => {
        processedFiles++;
      });

      archive.pipe(outputStream);

      // Append all media items
      const usedEntryNames = new Set<string>();
      for (const item of verifiedItems) {
        let entryName = item.entryName;
        // Avoid collision
        if (usedEntryNames.has(entryName)) {
          const ext = path.extname(entryName);
          const base = path.basename(entryName, ext);
          entryName = `${base}_${Date.now()}${ext}`;
        }
        usedEntryNames.add(entryName);

        archive.file(item.filePath, { name: entryName });
      }

      // Generate and append manifest.json
      const manifest = {
        title: options.archiveTitle || options.playlistMetadata?.title || 'MUXARO Media Batch',
        generatedAt: new Date().toISOString(),
        playlistMetadata: options.playlistMetadata,
        itemCount: verifiedItems.length,
        totalSizeBytes: totalInputBytes,
        items: verifiedItems.map((it, idx) => ({
          index: idx + 1,
          filename: it.entryName,
          sizeBytes: it.sizeBytes
        }))
      };

      archive.append(JSON.stringify(manifest, null, 2), { name: 'playlist_manifest.json' });

      // Generate human-readable README.txt
      const readmeLines = [
        '=================================================================',
        ` ${options.archiveTitle || 'MUXARO Media Package'}`,
        '=================================================================',
        `Generated: ${new Date().toUTCString()}`,
        `Total Items: ${verifiedItems.length}`,
        `Total Size: ${(totalInputBytes / (1024 * 1024)).toFixed(2)} MB`,
        '',
        'Contents:',
        ...verifiedItems.map((it, idx) => `  ${idx + 1}. ${it.entryName} (${(it.sizeBytes / (1024 * 1024)).toFixed(2)} MB)`),
        '',
        'Processed and verified by MUXARO High-Performance Media Worker.',
        '================================================================='
      ];
      archive.append(readmeLines.join('\n'), { name: 'README.txt' });

      archive.finalize();
    });
  }
}
