/**
 * @muxaro/media-splicer - Streaming Dual-Track DASH Box Splicer
 *
 * Pulls video and audio AsyncIterables incrementally, emits the merged
 * initialization header as soon as init segments arrive, and interleaves
 * media fragments/clusters strictly by PTS with constant bounded memory.
 */

import {
  concatBytes,
  detectContainerFamily,
  type ContainerFamily,
  type SpliceDashOptions,
  type SpliceFragment,
  type SpliceStats,
} from './types.ts';
import { IsomTrackReader, buildMergedIsomInit } from './isom-splicer.ts';
import { WebmTrackReader, buildMergedWebmInit } from './webm-splicer.ts';

interface TrackIteratorState<TReader> {
  reader: TReader;
  iterator: AsyncIterator<Uint8Array>;
  done: boolean;
}

async function pullUntil<TReader>(
  state: TrackIteratorState<TReader>,
  pushChunk: (reader: TReader, chunk: Uint8Array) => void,
  markEof: ((reader: TReader) => void) | null,
  tryProduce: (reader: TReader) => boolean,
  signal?: AbortSignal
): Promise<boolean> {
  while (!tryProduce(state.reader)) {
    if (signal?.aborted) {
      throw new Error('Splice aborted');
    }
    if (state.done) return false;
    const next = await state.iterator.next();
    if (next.done) {
      state.done = true;
      markEof?.(state.reader);
      return tryProduce(state.reader);
    }
    if (next.value && next.value.byteLength > 0) {
      pushChunk(state.reader, next.value);
    }
  }
  return true;
}

async function detectFamilyFromFirstChunk(
  iterator: AsyncIterator<Uint8Array>,
  hint?: ContainerFamily
): Promise<{ family: ContainerFamily; firstChunks: Uint8Array[]; done: boolean }> {
  const firstChunks: Uint8Array[] = [];
  let accumulated: Uint8Array = new Uint8Array(0);
  let done = false;

  while (accumulated.byteLength < 16) {
    const next = await iterator.next();
    if (next.done) {
      done = true;
      break;
    }
    if (next.value && next.value.byteLength > 0) {
      firstChunks.push(next.value);
      accumulated = concatBytes([accumulated, next.value]);
    }
  }

  const detected = detectContainerFamily(accumulated) || hint;
  if (!detected) {
    throw new Error('Unable to detect DASH container family (expected ISOBMFF fMP4 or WebM)');
  }

  return { family: detected, firstChunks, done };
}

export async function spliceDashStreams(options: SpliceDashOptions): Promise<SpliceStats> {
  const { videoChunks, audioChunks, sink, containerHint, signal, onProgress } = options;

  const videoIter = videoChunks[Symbol.asyncIterator]();
  const audioIter = audioChunks ? audioChunks[Symbol.asyncIterator]() : null;

  const probed = await detectFamilyFromFirstChunk(videoIter, containerHint);
  const family = probed.family;

  const stats: SpliceStats = {
    container: family,
    videoFragments: 0,
    audioFragments: 0,
    bytesWritten: 0,
    initBytes: 0,
  };

  let seq = 1;
  const allocateSeq = () => seq++;

  if (family === 'isom') {
    const vReader = new IsomTrackReader(1);
    for (const c of probed.firstChunks) vReader.push(c);
    const vState: TrackIteratorState<IsomTrackReader> = {
      reader: vReader,
      iterator: videoIter,
      done: probed.done,
    };

    const aState: TrackIteratorState<IsomTrackReader> | null = audioIter
      ? { reader: new IsomTrackReader(2), iterator: audioIter, done: false }
      : null;

    const [vInitOk, aInitOk] = await Promise.all([
      pullUntil(vState, (r, c) => r.push(c), null, (r) => r.tryReadInit(), signal),
      aState
        ? pullUntil(aState, (r, c) => r.push(c), null, (r) => r.tryReadInit(), signal)
        : Promise.resolve(true),
    ]);

    const vInit = vReader.getInit();
    if (!vInitOk || !vInit) {
      throw new Error('Video stream ended before ISOBMFF moov init segment');
    }

    const aInit = aState ? aState.reader.getInit() : null;
    if (aState && (!aInitOk || !aInit)) {
      throw new Error('Audio stream ended before ISOBMFF moov init segment');
    }

    const merged = buildMergedIsomInit(vInit.ftyp, vInit.moov, aInit?.moov);
    vReader.setTimescale(merged.videoTimescale);
    if (aState) aState.reader.setTimescale(merged.audioTimescale);

    await sink.write(merged.initSegment);
    stats.initBytes = merged.initSegment.byteLength;
    stats.bytesWritten += merged.initSegment.byteLength;
    onProgress?.({ ...stats });

    let nextVideoFrag: SpliceFragment | null = null;
    let nextAudioFrag: SpliceFragment | null = null;

    const refillVideo = async () => {
      if (nextVideoFrag) return;
      await pullUntil(
        vState,
        (r, c) => r.push(c),
        null,
        (r) => {
          nextVideoFrag = r.popFragment(allocateSeq);
          return nextVideoFrag !== null;
        },
        signal
      );
    };

    const refillAudio = async () => {
      if (!aState || nextAudioFrag) return;
      await pullUntil(
        aState,
        (r, c) => r.push(c),
        null,
        (r) => {
          nextAudioFrag = r.popFragment(allocateSeq);
          return nextAudioFrag !== null;
        },
        signal
      );
    };

    while (true) {
      await Promise.all([refillVideo(), refillAudio()]);
      const vf = nextVideoFrag as SpliceFragment | null;
      const af = nextAudioFrag as SpliceFragment | null;

      if (!vf && !af) break;

      if (vf && (!af || vf.ptsMs <= af.ptsMs)) {
        nextVideoFrag = null;
        await sink.write(vf.bytes);
        stats.videoFragments++;
        stats.bytesWritten += vf.bytes.byteLength;
      } else if (af) {
        nextAudioFrag = null;
        await sink.write(af.bytes);
        stats.audioFragments++;
        stats.bytesWritten += af.bytes.byteLength;
      }

      onProgress?.({ ...stats });
    }
  } else {
    const vReader = new WebmTrackReader(1);
    for (const c of probed.firstChunks) vReader.push(c);
    if (probed.done) vReader.markEof();

    const vState: TrackIteratorState<WebmTrackReader> = {
      reader: vReader,
      iterator: videoIter,
      done: probed.done,
    };

    const aState: TrackIteratorState<WebmTrackReader> | null = audioIter
      ? { reader: new WebmTrackReader(2), iterator: audioIter, done: false }
      : null;

    const [vInitOk, aInitOk] = await Promise.all([
      pullUntil(vState, (r, c) => r.push(c), (r) => r.markEof(), (r) => r.tryReadInit(), signal),
      aState
        ? pullUntil(aState, (r, c) => r.push(c), (r) => r.markEof(), (r) => r.tryReadInit(), signal)
        : Promise.resolve(true),
    ]);

    const vInit = vReader.getInit();
    if (!vInitOk || !vInit) {
      throw new Error('Video stream ended before WebM Tracks init segment');
    }

    const aInit = aState ? aState.reader.getInit() : null;
    if (aState && (!aInitOk || !aInit)) {
      throw new Error('Audio stream ended before WebM Tracks init segment');
    }

    const initBytes = buildMergedWebmInit(
      vInit.ebmlHeader,
      vInit.infoElem,
      vInit.tracksElem,
      aInit?.tracksElem
    );

    await sink.write(initBytes);
    stats.initBytes = initBytes.byteLength;
    stats.bytesWritten += initBytes.byteLength;
    onProgress?.({ ...stats });

    let nextVideoCluster: SpliceFragment | null = null;
    let nextAudioCluster: SpliceFragment | null = null;

    const refillVideo = async () => {
      if (nextVideoCluster) return;
      await pullUntil(
        vState,
        (r, c) => r.push(c),
        (r) => r.markEof(),
        (r) => {
          nextVideoCluster = r.popCluster();
          return nextVideoCluster !== null;
        },
        signal
      );
    };

    const refillAudio = async () => {
      if (!aState || nextAudioCluster) return;
      await pullUntil(
        aState,
        (r, c) => r.push(c),
        (r) => r.markEof(),
        (r) => {
          nextAudioCluster = r.popCluster();
          return nextAudioCluster !== null;
        },
        signal
      );
    };

    while (true) {
      await Promise.all([refillVideo(), refillAudio()]);
      const vc = nextVideoCluster as SpliceFragment | null;
      const ac = nextAudioCluster as SpliceFragment | null;

      if (!vc && !ac) break;

      if (vc && (!ac || vc.ptsMs <= ac.ptsMs)) {
        nextVideoCluster = null;
        await sink.write(vc.bytes);
        stats.videoFragments++;
        stats.bytesWritten += vc.bytes.byteLength;
      } else if (ac) {
        nextAudioCluster = null;
        await sink.write(ac.bytes);
        stats.audioFragments++;
        stats.bytesWritten += ac.bytes.byteLength;
      }

      onProgress?.({ ...stats });
    }
  }

  await sink.close?.();
  return stats;
}
