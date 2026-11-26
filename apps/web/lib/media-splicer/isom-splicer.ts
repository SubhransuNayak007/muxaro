/**
 * @muxaro/media-splicer - Zero-Copy ISOBMFF (fMP4) Streaming Box Splicer
 *
 * Reads single-track DASH fMP4 streams (ftyp + moov + [moof + mdat]*)
 * and emits a single valid 2-track fragmented MP4 stream with constant RAM.
 */

import { ByteQueue, concatBytes, type SpliceFragment } from './types.ts';

interface ParsedBox {
  type: string;
  headerSize: number;
  totalSize: number;
  data: Uint8Array;
}

export interface ParsedIsomTrackInit {
  ftyp?: Uint8Array;
  trak: Uint8Array;
  trex?: Uint8Array;
  timescale: number;
  handlerType: string;
  originalTrackId: number;
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

function writeU32BE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = (val >>> 24) & 0xff;
  buf[offset + 1] = (val >>> 16) & 0xff;
  buf[offset + 2] = (val >>> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}

function readU64BE(buf: Uint8Array, offset: number): bigint {
  const hi = BigInt(readU32BE(buf, offset));
  const lo = BigInt(readU32BE(buf, offset + 4));
  return (hi << BigInt(32)) | lo;
}

function readFourCC(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(
    buf[offset],
    buf[offset + 1],
    buf[offset + 2],
    buf[offset + 3]
  );
}

function buildBox(type: string, payloadParts: Uint8Array[]): Uint8Array {
  let payloadLen = 0;
  for (const p of payloadParts) payloadLen += p.byteLength;
  const totalSize = 8 + payloadLen;
  const out = new Uint8Array(totalSize);
  writeU32BE(out, 0, totalSize);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  let offset = 8;
  for (const p of payloadParts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

function iterChildBoxes(
  containerPayload: Uint8Array
): Array<{ type: string; box: Uint8Array; payloadOffset: number; totalSize: number }> {
  const boxes: Array<{ type: string; box: Uint8Array; payloadOffset: number; totalSize: number }> = [];
  let offset = 0;
  while (offset + 8 <= containerPayload.byteLength) {
    let size = readU32BE(containerPayload, offset);
    const type = readFourCC(containerPayload, offset + 4);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > containerPayload.byteLength) break;
      size = Number(readU64BE(containerPayload, offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = containerPayload.byteLength - offset;
    }
    if (size < headerSize || offset + size > containerPayload.byteLength) break;
    boxes.push({
      type,
      box: containerPayload.subarray(offset, offset + size),
      payloadOffset: headerSize,
      totalSize: size,
    });
    offset += size;
  }
  return boxes;
}

function patchTrakTrackId(trakBox: Uint8Array, newTrackId: number): {
  patchedTrak: Uint8Array;
  timescale: number;
  handlerType: string;
  originalTrackId: number;
} {
  const copy = new Uint8Array(trakBox);
  let timescale = 90000;
  let handlerType = 'vide';
  let originalTrackId = 1;

  for (const child of iterChildBoxes(copy.subarray(8))) {
    if (child.type === 'tkhd') {
      const version = child.box[child.payloadOffset];
      const idOffset = child.payloadOffset + (version === 1 ? 20 : 12);
      if (idOffset + 4 <= child.box.byteLength) {
        originalTrackId = readU32BE(child.box, idOffset);
        writeU32BE(child.box, idOffset, newTrackId);
      }
    } else if (child.type === 'mdia') {
      for (const mdiaChild of iterChildBoxes(child.box.subarray(child.payloadOffset))) {
        if (mdiaChild.type === 'mdhd') {
          const version = mdiaChild.box[mdiaChild.payloadOffset];
          const tsOffset = mdiaChild.payloadOffset + (version === 1 ? 20 : 12);
          if (tsOffset + 4 <= mdiaChild.box.byteLength) {
            timescale = readU32BE(mdiaChild.box, tsOffset) || 90000;
          }
        } else if (mdiaChild.type === 'hdlr') {
          const htOffset = mdiaChild.payloadOffset + 8;
          if (htOffset + 4 <= mdiaChild.box.byteLength) {
            handlerType = readFourCC(mdiaChild.box, htOffset);
          }
        }
      }
    }
  }

  return { patchedTrak: copy, timescale, handlerType, originalTrackId };
}

function buildDefaultTrex(trackId: number): Uint8Array {
  const payload = new Uint8Array(24);
  // version(1)=0, flags(3)=0
  writeU32BE(payload, 4, trackId);
  writeU32BE(payload, 8, 1); // default_sample_description_index
  return buildBox('trex', [payload]);
}

function patchTrexTrackId(trexBox: Uint8Array, newTrackId: number): Uint8Array {
  const copy = new Uint8Array(trexBox);
  if (copy.byteLength >= 16) {
    writeU32BE(copy, 12, newTrackId);
  }
  return copy;
}

function patchMvhdNextTrackId(mvhdBox: Uint8Array, nextTrackId: number): Uint8Array {
  const copy = new Uint8Array(mvhdBox);
  if (copy.byteLength >= 12) {
    writeU32BE(copy, copy.byteLength - 4, nextTrackId);
  }
  return copy;
}

export function buildMergedIsomInit(
  videoFtyp: Uint8Array | undefined,
  videoMoov: Uint8Array,
  audioMoov: Uint8Array | undefined
): {
  initSegment: Uint8Array;
  videoTimescale: number;
  audioTimescale: number;
} {
  let mvhdBox: Uint8Array | undefined;
  let videoTrak: Uint8Array | undefined;
  let videoTrex: Uint8Array | undefined;
  let videoTimescale = 90000;

  for (const child of iterChildBoxes(videoMoov.subarray(8))) {
    if (child.type === 'mvhd') {
      mvhdBox = patchMvhdNextTrackId(child.box, audioMoov ? 3 : 2);
    } else if (child.type === 'trak' && !videoTrak) {
      const parsed = patchTrakTrackId(child.box, 1);
      videoTrak = parsed.patchedTrak;
      videoTimescale = parsed.timescale;
    } else if (child.type === 'mvex') {
      for (const mvChild of iterChildBoxes(child.box.subarray(child.payloadOffset))) {
        if (mvChild.type === 'trex' && !videoTrex) {
          videoTrex = patchTrexTrackId(mvChild.box, 1);
        }
      }
    }
  }

  if (!mvhdBox || !videoTrak) {
    throw new Error('Invalid video ISOBMFF moov box: missing mvhd or trak');
  }

  let audioTrak: Uint8Array | undefined;
  let audioTrex: Uint8Array | undefined;
  let audioTimescale = 48000;

  if (audioMoov) {
    for (const child of iterChildBoxes(audioMoov.subarray(8))) {
      if (child.type === 'trak' && !audioTrak) {
        const parsed = patchTrakTrackId(child.box, 2);
        audioTrak = parsed.patchedTrak;
        audioTimescale = parsed.timescale;
      } else if (child.type === 'mvex') {
        for (const mvChild of iterChildBoxes(child.box.subarray(child.payloadOffset))) {
          if (mvChild.type === 'trex' && !audioTrex) {
            audioTrex = patchTrexTrackId(mvChild.box, 2);
          }
        }
      }
    }
  }

  const mvexChildren: Uint8Array[] = [videoTrex || buildDefaultTrex(1)];
  if (audioTrak) {
    mvexChildren.push(audioTrex || buildDefaultTrex(2));
  }
  const mvexBox = buildBox('mvex', mvexChildren);

  const moovChildren: Uint8Array[] = [mvhdBox, videoTrak];
  if (audioTrak) moovChildren.push(audioTrak);
  moovChildren.push(mvexBox);

  const mergedMoov = buildBox('moov', moovChildren);
  const ftyp = videoFtyp || buildDefaultFtyp();

  return {
    initSegment: concatBytes([ftyp, mergedMoov]),
    videoTimescale,
    audioTimescale,
  };
}

function buildDefaultFtyp(): Uint8Array {
  const payload = new Uint8Array(24);
  const enc = (str: string, off: number) => {
    for (let i = 0; i < 4; i++) payload[off + i] = str.charCodeAt(i);
  };
  enc('iso6', 0);
  writeU32BE(payload, 4, 1);
  enc('isom', 8);
  enc('iso6', 12);
  enc('mp41', 16);
  enc('dash', 20);
  return buildBox('ftyp', [payload]);
}

function extractTfdtAndPatchMoof(
  moofBytes: Uint8Array,
  targetTrackId: number,
  timescale: number,
  sequenceNumber: number
): number {
  let ptsMs = 0;

  for (const child of iterChildBoxes(moofBytes.subarray(8))) {
    if (child.type === 'mfhd') {
      if (child.payloadOffset + 8 <= child.box.byteLength) {
        writeU32BE(child.box, child.payloadOffset + 4, sequenceNumber);
      }
    } else if (child.type === 'traf') {
      for (const trafChild of iterChildBoxes(child.box.subarray(child.payloadOffset))) {
        if (trafChild.type === 'tfhd') {
          if (trafChild.payloadOffset + 8 <= trafChild.box.byteLength) {
            writeU32BE(trafChild.box, trafChild.payloadOffset + 4, targetTrackId);
          }
        } else if (trafChild.type === 'tfdt') {
          const version = trafChild.box[trafChild.payloadOffset];
          const baseOffset = trafChild.payloadOffset + 4;
          if (version === 1 && baseOffset + 8 <= trafChild.box.byteLength) {
            const baseTime = readU64BE(trafChild.box, baseOffset);
            ptsMs = (Number(baseTime) / timescale) * 1000;
          } else if (baseOffset + 4 <= trafChild.box.byteLength) {
            const baseTime = readU32BE(trafChild.box, baseOffset);
            ptsMs = (baseTime / timescale) * 1000;
          }
        }
      }
    }
  }

  return ptsMs;
}

/**
 * Stateful incremental ISOBMFF track reader.
 * Yields ftyp/moov init boxes first, then paired (moof + mdat) fragments.
 */
export class IsomTrackReader {
  private readonly queue = new ByteQueue();
  private ftypBox?: Uint8Array;
  private moovBox?: Uint8Array;
  private pendingMoof?: Uint8Array;
  private readonly targetTrackId: number;
  private timescale = 90000;

  constructor(targetTrackId: number) {
    this.targetTrackId = targetTrackId;
  }

  public setTimescale(timescale: number): void {
    if (timescale > 0) this.timescale = timescale;
  }

  public push(chunk: Uint8Array): void {
    this.queue.push(chunk);
  }

  public hasInit(): boolean {
    return Boolean(this.moovBox);
  }

  public getInit(): { ftyp?: Uint8Array; moov: Uint8Array } | null {
    if (!this.moovBox) return null;
    return { ftyp: this.ftypBox, moov: this.moovBox };
  }

  private nextBox(): ParsedBox | null {
    const view = this.queue.peek();
    if (view.byteLength < 8) return null;
    let size = readU32BE(view, 0);
    const type = readFourCC(view, 4);
    let headerSize = 8;
    if (size === 1) {
      if (view.byteLength < 16) return null;
      size = Number(readU64BE(view, 8));
      headerSize = 16;
    } else if (size === 0) {
      return null;
    }
    if (size < headerSize || view.byteLength < size) return null;
    const consumed = this.queue.consume(size);
    // Copy out of queue backing array so subsequent compactions can't mutate
    const data = new Uint8Array(consumed);
    return { type, headerSize, totalSize: size, data };
  }

  /**
   * Advances box parsing until init (`moov`) is captured.
   */
  public tryReadInit(): boolean {
    while (!this.moovBox) {
      const box = this.nextBox();
      if (!box) return false;
      if (box.type === 'ftyp') {
        this.ftypBox = box.data;
      } else if (box.type === 'moov') {
        this.moovBox = box.data;
        return true;
      }
    }
    return true;
  }

  /**
   * Pops the next complete (moof + mdat) fragment, patching track_ID in-place.
   * Caller supplies sequence number when emitting.
   */
  public popFragment(allocateSeq: () => number): SpliceFragment | null {
    while (true) {
      const box = this.nextBox();
      if (!box) return null;

      if (box.type === 'moof') {
        this.pendingMoof = box.data;
        continue;
      }

      if (box.type === 'mdat' && this.pendingMoof) {
        const moof = this.pendingMoof;
        this.pendingMoof = undefined;
        const seq = allocateSeq();
        const ptsMs = extractTfdtAndPatchMoof(
          moof,
          this.targetTrackId,
          this.timescale,
          seq
        );
        return {
          ptsMs,
          bytes: concatBytes([moof, box.data]),
        };
      }

      // Skip sidx, styp, free, skip, emsg, prft
    }
  }
}
