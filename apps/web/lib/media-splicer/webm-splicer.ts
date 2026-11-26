/**
 * @muxaro/media-splicer - Zero-Copy WebM / Matroska Streaming Box Splicer
 *
 * Reads single-track WebM streams (EBML + Segment + Info + Tracks + Cluster*)
 * and emits a single open-ended streaming WebM/Matroska container with
 * monotonically interleaved Clusters and constant RAM footprint.
 */

import { ByteQueue, concatBytes, type SpliceFragment } from './types.ts';

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_TRACK_UID = 0x73c5;
const ID_CLUSTER = 0x1f43b675;
const ID_CLUSTER_TIMECODE = 0xe7;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK_GROUP = 0xa0;
const ID_BLOCK = 0xa1;

const UNKNOWN_SIZE_BYTES = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

function readElementId(buf: Uint8Array, offset: number): { id: number; length: number } | null {
  if (offset >= buf.byteLength) return null;
  const first = buf[offset];
  if (first === 0) return null;

  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (first & mask) === 0) {
    mask >>= 1;
    length++;
  }
  if (length > 4 || offset + length > buf.byteLength) return null;

  let id = 0;
  for (let i = 0; i < length; i++) {
    id = id * 256 + buf[offset + i];
  }
  return { id, length };
}

function readVintSize(
  buf: Uint8Array,
  offset: number
): { size: number; length: number; unknown: boolean } | null {
  if (offset >= buf.byteLength) return null;
  const first = buf[offset];
  if (first === 0) return null;

  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length++;
  }
  if (length > 8 || offset + length > buf.byteLength) return null;

  let value = BigInt(first & ~mask);
  let allOnes = (first & ~mask) === (mask - 1);

  for (let i = 1; i < length; i++) {
    const b = buf[offset + i];
    value = (value << BigInt(8)) | BigInt(b);
    if (b !== 0xff) allOnes = false;
  }

  return {
    size: Number(value),
    length,
    unknown: allOnes,
  };
}

function encodeId(id: number): Uint8Array {
  let byteLen = 1;
  if (id > 0xffffff) byteLen = 4;
  else if (id > 0xffff) byteLen = 3;
  else if (id > 0xff) byteLen = 2;

  const out = new Uint8Array(byteLen);
  let tmp = id;
  for (let i = byteLen - 1; i >= 0; i--) {
    out[i] = tmp & 0xff;
    tmp >>>= 8;
  }
  return out;
}

function encodeVintSize(size: number): Uint8Array {
  let len = 1;
  if (size >= 0x7f && size < 0x3fff) len = 2;
  else if (size >= 0x3fff && size < 0x1fffff) len = 3;
  else if (size >= 0x1fffff && size < 0x0fffffff) len = 4;
  else if (size >= 0x0fffffff) len = 8;

  const out = new Uint8Array(len);
  let val = BigInt(size);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(val & BigInt(0xff));
    val >>= BigInt(8);
  }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

function buildEbmlElement(id: number, payload: Uint8Array): Uint8Array {
  return concatBytes([encodeId(id), encodeVintSize(payload.byteLength), payload]);
}

function readUintPayload(buf: Uint8Array): number {
  let val = 0;
  for (let i = 0; i < buf.byteLength; i++) {
    val = val * 256 + buf[i];
  }
  return val;
}

function iterEbmlChildren(
  payload: Uint8Array
): Array<{ id: number; headerLen: number; payload: Uint8Array; raw: Uint8Array }> {
  const res: Array<{ id: number; headerLen: number; payload: Uint8Array; raw: Uint8Array }> = [];
  let offset = 0;
  while (offset < payload.byteLength) {
    const idInfo = readElementId(payload, offset);
    if (!idInfo) break;
    const sizeInfo = readVintSize(payload, offset + idInfo.length);
    if (!sizeInfo || sizeInfo.unknown) break;
    const headerLen = idInfo.length + sizeInfo.length;
    const end = offset + headerLen + sizeInfo.size;
    if (end > payload.byteLength) break;
    res.push({
      id: idInfo.id,
      headerLen,
      payload: payload.subarray(offset + headerLen, end),
      raw: payload.subarray(offset, end),
    });
    offset = end;
  }
  return res;
}

function parseTimecodeScale(infoPayload: Uint8Array): number {
  for (const child of iterEbmlChildren(infoPayload)) {
    if (child.id === ID_TIMECODE_SCALE) {
      return readUintPayload(child.payload) || 1_000_000;
    }
  }
  return 1_000_000;
}

function patchAudioTrackEntry(trackEntryPayload: Uint8Array, newTrackNumber: number): Uint8Array {
  const rebuiltParts: Uint8Array[] = [];
  for (const child of iterEbmlChildren(trackEntryPayload)) {
    if (child.id === ID_TRACK_NUMBER) {
      rebuiltParts.push(buildEbmlElement(ID_TRACK_NUMBER, new Uint8Array([newTrackNumber])));
    } else if (child.id === ID_TRACK_UID) {
      const uid = new Uint8Array(child.payload);
      if (uid.byteLength > 0) uid[uid.byteLength - 1] ^= 0x02;
      rebuiltParts.push(buildEbmlElement(ID_TRACK_UID, uid));
    } else {
      rebuiltParts.push(child.raw);
    }
  }
  return buildEbmlElement(ID_TRACK_ENTRY, concatBytes(rebuiltParts));
}

function extractTrackEntries(tracksPayload: Uint8Array): Uint8Array[] {
  const entries: Uint8Array[] = [];
  for (const child of iterEbmlChildren(tracksPayload)) {
    if (child.id === ID_TRACK_ENTRY) {
      entries.push(new Uint8Array(child.raw));
    }
  }
  return entries;
}

export function buildMergedWebmInit(
  videoEbmlHeader: Uint8Array,
  videoInfo: Uint8Array,
  videoTracks: Uint8Array,
  audioTracks?: Uint8Array
): Uint8Array {
  const videoTrackEntries = extractTrackEntries(videoTracks.subarray(getHeaderLen(videoTracks)));
  const mergedEntries: Uint8Array[] = [...videoTrackEntries];

  if (audioTracks) {
    const audioTrackEntries = extractTrackEntries(audioTracks.subarray(getHeaderLen(audioTracks)));
    for (const entry of audioTrackEntries) {
      const hdr = getHeaderLen(entry);
      mergedEntries.push(patchAudioTrackEntry(entry.subarray(hdr), 2));
    }
  }

  const mergedTracksElem = buildEbmlElement(ID_TRACKS, concatBytes(mergedEntries));
  const segmentHeader = concatBytes([encodeId(ID_SEGMENT), UNKNOWN_SIZE_BYTES]);

  return concatBytes([videoEbmlHeader, segmentHeader, videoInfo, mergedTracksElem]);
}

function getHeaderLen(elem: Uint8Array): number {
  const idInfo = readElementId(elem, 0);
  if (!idInfo) return 0;
  const sizeInfo = readVintSize(elem, idInfo.length);
  if (!sizeInfo) return idInfo.length;
  return idInfo.length + sizeInfo.length;
}

function patchClusterAndReadTimecode(
  clusterPayload: Uint8Array,
  targetTrackNumber: number,
  timecodeScaleNs: number
): number {
  let clusterTimecode = 0;

  for (const child of iterEbmlChildren(clusterPayload)) {
    if (child.id === ID_CLUSTER_TIMECODE) {
      clusterTimecode = readUintPayload(child.payload);
    } else if (child.id === ID_SIMPLE_BLOCK) {
      if (targetTrackNumber !== 1 && child.payload.byteLength >= 1) {
        // TrackNumber 1..126 encodes as single-byte VINT: 0x80 | trackNumber
        child.payload[0] = 0x80 | targetTrackNumber;
      }
    } else if (child.id === ID_BLOCK_GROUP) {
      if (targetTrackNumber !== 1) {
        for (const bgChild of iterEbmlChildren(child.payload)) {
          if (bgChild.id === ID_BLOCK && bgChild.payload.byteLength >= 1) {
            bgChild.payload[0] = 0x80 | targetTrackNumber;
          }
        }
      }
    }
  }

  return clusterTimecode * (timecodeScaleNs / 1_000_000);
}

/**
 * Stateful incremental WebM/Matroska track reader.
 * Captures EBML, Info, Tracks, and then emits complete Clusters.
 */
export class WebmTrackReader {
  private readonly queue = new ByteQueue();
  private ebmlHeader?: Uint8Array;
  private infoElem?: Uint8Array;
  private tracksElem?: Uint8Array;
  private enteredSegment = false;
  private timecodeScaleNs = 1_000_000;
  private readonly targetTrackNumber: number;
  private eof = false;

  constructor(targetTrackNumber: number) {
    this.targetTrackNumber = targetTrackNumber;
  }

  public push(chunk: Uint8Array): void {
    this.queue.push(chunk);
  }

  public markEof(): void {
    this.eof = true;
  }

  public getInit(): {
    ebmlHeader: Uint8Array;
    infoElem: Uint8Array;
    tracksElem: Uint8Array;
    timecodeScaleNs: number;
  } | null {
    if (!this.ebmlHeader || !this.infoElem || !this.tracksElem) return null;
    return {
      ebmlHeader: this.ebmlHeader,
      infoElem: this.infoElem,
      tracksElem: this.tracksElem,
      timecodeScaleNs: this.timecodeScaleNs,
    };
  }

  public tryReadInit(): boolean {
    while (!this.tracksElem || !this.infoElem) {
      const view = this.queue.peek();
      if (view.byteLength < 2) return false;

      const idInfo = readElementId(view, 0);
      if (!idInfo) return false;
      const sizeInfo = readVintSize(view, idInfo.length);
      if (!sizeInfo) return false;
      const headerLen = idInfo.length + sizeInfo.length;

      if (idInfo.id === ID_SEGMENT && !this.enteredSegment) {
        // Enter Segment without consuming its children
        this.queue.consume(headerLen);
        this.enteredSegment = true;
        continue;
      }

      if (sizeInfo.unknown) {
        return false;
      }

      const totalSize = headerLen + sizeInfo.size;
      if (view.byteLength < totalSize) return false;

      // If we somehow hit Cluster before seeing Info+Tracks, stop
      if (idInfo.id === ID_CLUSTER) {
        return Boolean(this.ebmlHeader && this.infoElem && this.tracksElem);
      }

      const raw = new Uint8Array(this.queue.consume(totalSize));

      if (idInfo.id === ID_EBML) {
        this.ebmlHeader = raw;
      } else if (idInfo.id === ID_INFO) {
        this.infoElem = raw;
        this.timecodeScaleNs = parseTimecodeScale(raw.subarray(headerLen));
      } else if (idInfo.id === ID_TRACKS) {
        this.tracksElem = raw;
      }
    }

    return Boolean(this.ebmlHeader && this.infoElem && this.tracksElem);
  }

  public popCluster(): SpliceFragment | null {
    while (true) {
      const view = this.queue.peek();
      if (view.byteLength < 4) return null;

      const idInfo = readElementId(view, 0);
      if (!idInfo) return null;
      const sizeInfo = readVintSize(view, idInfo.length);
      if (!sizeInfo) return null;
      const headerLen = idInfo.length + sizeInfo.length;

      if (idInfo.id !== ID_CLUSTER) {
        if (sizeInfo.unknown) return null;
        const totalSize = headerLen + sizeInfo.size;
        if (view.byteLength < totalSize) return null;
        // Skip Cues, Tags, Void, SeekHead after init
        this.queue.consume(totalSize);
        continue;
      }

      // Known-size Cluster
      if (!sizeInfo.unknown) {
        const totalSize = headerLen + sizeInfo.size;
        if (view.byteLength < totalSize) return null;
        const raw = new Uint8Array(this.queue.consume(totalSize));
        const ptsMs = patchClusterAndReadTimecode(
          raw.subarray(headerLen),
          this.targetTrackNumber,
          this.timecodeScaleNs
        );
        return { ptsMs, bytes: raw };
      }

      // Unknown-size Cluster: scan children until next Cluster or EOF
      let scanOffset = headerLen;
      let foundEnd = false;
      while (scanOffset < view.byteLength) {
        const cId = readElementId(view, scanOffset);
        if (!cId) break;
        if (cId.id === ID_CLUSTER) {
          foundEnd = true;
          break;
        }
        const cSize = readVintSize(view, scanOffset + cId.length);
        if (!cSize || cSize.unknown) break;
        const nextOff = scanOffset + cId.length + cSize.length + cSize.size;
        if (nextOff > view.byteLength) break;
        scanOffset = nextOff;
      }

      if (!foundEnd && !this.eof) return null;
      const payloadLen = (foundEnd ? scanOffset : view.byteLength) - headerLen;
      if (payloadLen <= 0 && !this.eof) return null;

      const consumed = new Uint8Array(this.queue.consume(headerLen + payloadLen));
      const payloadCopy = new Uint8Array(consumed.subarray(headerLen));
      const ptsMs = patchClusterAndReadTimecode(
        payloadCopy,
        this.targetTrackNumber,
        this.timecodeScaleNs
      );
      return {
        ptsMs,
        bytes: buildEbmlElement(ID_CLUSTER, payloadCopy),
      };
    }
  }
}
