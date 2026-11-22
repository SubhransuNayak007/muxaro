/**
 * MUXARO Zero-Wait Pipelined Stream Engine - Stage 3: Pure-TS WebM/MKV Streaming Muxer
 * apps/web/lib/stream-engine/webm.ts
 *
 * Real-Time WebM / Matroska Streaming Muxer:
 * - Generates EBML header and open streaming Segment (unknown length)
 * - Streams VP9 / AV1 / H.264 video and Opus / AAC audio via real-time Clusters
 * - Interleaves SimpleBlocks monotonically by timestamp
 * - 0-second merge wait after 100% download
 */

import type { MediaSample, VideoTrackConfig, AudioTrackConfig } from './types.ts';

function writeVint(value: number | bigint, length?: number): Uint8Array {
  const v = typeof value === 'bigint' ? value : BigInt(value);
  let len = length;

  if (!len) {
    if (v < BigInt(0x7f)) len = 1;
    else if (v < BigInt(0x3fff)) len = 2;
    else if (v < BigInt(0x1fffff)) len = 3;
    else if (v < BigInt(0x0fffffff)) len = 4;
    else if (v < BigInt('0x07ffffffff')) len = 5;
    else if (v < BigInt('0x03ffffffffff')) len = 6;
    else if (v < BigInt('0x01ffffffffffff')) len = 7;
    else len = 8;
  }

  const out = new Uint8Array(len);
  let mask = 0x80 >> (len - 1);
  let val = v;

  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(val & BigInt(0xff));
    val = val >> BigInt(8);
  }
  out[0] |= mask;
  return out;
}

class EbmlWriter {
  private parts: Uint8Array[] = [];

  public writeRaw(bytes: Uint8Array): void {
    this.parts.push(bytes);
  }

  public writeId(id: number): void {
    const hex = id.toString(16);
    const byteLen = Math.ceil(hex.length / 2);
    const arr = new Uint8Array(byteLen);
    let temp = id;
    for (let i = byteLen - 1; i >= 0; i--) {
      arr[i] = temp & 0xff;
      temp >>= 8;
    }
    this.parts.push(arr);
  }

  public writeElement(id: number, payload: Uint8Array): void {
    this.writeId(id);
    this.writeRaw(writeVint(payload.byteLength));
    this.writeRaw(payload);
  }

  public writeUint(id: number, value: number | bigint): void {
    const v = typeof value === 'bigint' ? value : BigInt(Math.floor(value));
    let byteLen = 1;
    if (v > BigInt(0xffffff)) byteLen = 4;
    else if (v > BigInt(0xffff)) byteLen = 3;
    else if (v > BigInt(0xff)) byteLen = 2;

    const buf = new Uint8Array(byteLen);
    let temp = v;
    for (let i = byteLen - 1; i >= 0; i--) {
      buf[i] = Number(temp & BigInt(0xff));
      temp = temp >> BigInt(8);
    }
    this.writeElement(id, buf);
  }

  public writeString(id: number, str: string): void {
    const encoded = new TextEncoder().encode(str);
    this.writeElement(id, encoded);
  }

  public writeFloat32(id: number, val: number): void {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setFloat32(0, val, false);
    this.writeElement(id, buf);
  }

  public toUint8Array(): Uint8Array {
    let total = 0;
    for (const p of this.parts) total += p.byteLength;
    const res = new Uint8Array(total);
    let offset = 0;
    for (const p of this.parts) {
      res.set(p, offset);
      offset += p.byteLength;
    }
    return res;
  }
}

export class WebmMuxer {
  private videoTrack?: VideoTrackConfig;
  private audioTrack?: AudioTrackConfig;
  private isMatroska: boolean = false;
  private clusterSequence: number = 0;

  constructor(videoTrack?: VideoTrackConfig, audioTrack?: AudioTrackConfig, isMatroska = false) {
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
    this.isMatroska = isMatroska;
  }

  /**
   * Generates the EBML header + Segment header with unknown streaming size
   */
  public generateInitSegment(): Uint8Array {
    const ebml = new EbmlWriter();

    // 1. EBML Header (0x1A45DFA3)
    const headerPayload = new EbmlWriter();
    headerPayload.writeUint(0x4286, 1); // EBMLVersion
    headerPayload.writeUint(0x42f7, 1); // EBMLReadVersion
    headerPayload.writeUint(0x42f2, 4); // EBMLMaxIDLength
    headerPayload.writeUint(0x42f3, 8); // EBMLMaxSizeLength
    headerPayload.writeString(0x4282, this.isMatroska ? 'matroska' : 'webm'); // DocType
    headerPayload.writeUint(0x4287, 4); // DocTypeVersion
    headerPayload.writeUint(0x4285, 2); // DocTypeReadVersion
    ebml.writeElement(0x1a45dfa3, headerPayload.toUint8Array());

    // 2. Segment (0x18538067) with Unknown Size (0x01FFFFFFFFFFFFFF)
    ebml.writeId(0x18538067);
    // 8-byte unknown size vint
    ebml.writeRaw(new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));

    // 3. Segment Info (0x1549A966)
    const infoPayload = new EbmlWriter();
    infoPayload.writeUint(0x2ad7b1, 1000000); // TimestampScale = 1ms (1,000,000 ns)
    infoPayload.writeString(0x4d80, 'MUXARO Zero-Wait Stream-Muxer');
    infoPayload.writeString(0x5741, 'MUXARO Pure-TS Browser Engine');
    ebml.writeElement(0x1549a966, infoPayload.toUint8Array());

    // 4. Tracks (0x1654AE6B)
    const tracksPayload = new EbmlWriter();

    if (this.videoTrack) {
      const vTrack = new EbmlWriter();
      vTrack.writeUint(0xd7, this.videoTrack.trackId || 1); // TrackNumber
      vTrack.writeUint(0x73c5, this.videoTrack.trackId || 1); // TrackUID
      vTrack.writeUint(0x83, 1); // TrackType: 1 = Video
      vTrack.writeUint(0x9c, 0); // FlagLacing = 0

      let codecId = 'V_VP9';
      if (this.videoTrack.codec.includes('avc') || this.videoTrack.codec.includes('264')) {
        codecId = 'V_MPEG4/ISO/AVC';
      } else if (this.videoTrack.codec.includes('av01') || this.videoTrack.codec.includes('av1')) {
        codecId = 'V_AV1';
      }
      vTrack.writeString(0x86, codecId);

      // Video Settings (0xE0)
      const vSettings = new EbmlWriter();
      vSettings.writeUint(0xb0, this.videoTrack.width); // PixelWidth
      vSettings.writeUint(0xba, this.videoTrack.height); // PixelHeight
      vTrack.writeElement(0xe0, vSettings.toUint8Array());

      tracksPayload.writeElement(0xae, vTrack.toUint8Array());
    }

    if (this.audioTrack) {
      const aTrack = new EbmlWriter();
      aTrack.writeUint(0xd7, this.audioTrack.trackId || 2); // TrackNumber
      aTrack.writeUint(0x73c5, this.audioTrack.trackId || 2); // TrackUID
      aTrack.writeUint(0x83, 2); // TrackType: 2 = Audio
      aTrack.writeUint(0x9c, 0); // FlagLacing = 0

      const codecId = this.audioTrack.codec.includes('aac') ? 'A_AAC' : 'A_OPUS';
      aTrack.writeString(0x86, codecId);

      // Audio Settings (0xE1)
      const aSettings = new EbmlWriter();
      aSettings.writeFloat32(0xb5, this.audioTrack.sampleRate || 48000); // SamplingFrequency
      aSettings.writeUint(0x9f, this.audioTrack.channelCount || 2); // Channels
      aTrack.writeElement(0xe1, aSettings.toUint8Array());

      tracksPayload.writeElement(0xae, aTrack.toUint8Array());
    }

    ebml.writeElement(0x1654ae6b, tracksPayload.toUint8Array());

    return ebml.toUint8Array();
  }

  /**
   * Generates a streaming Cluster containing interleaved video and audio SimpleBlocks
   */
  public generateCluster(samples: MediaSample[]): Uint8Array {
    if (samples.length === 0) return new Uint8Array(0);

    const clusterTimecodeMs = Math.floor(
      (samples[0].pts / (samples[0].timescale || 1000)) * 1000
    );

    const clusterWriter = new EbmlWriter();
    // Timecode (0xE7)
    clusterWriter.writeUint(0xe7, Math.max(0, clusterTimecodeMs));

    // SimpleBlock (0xA3) for each sample
    for (const s of samples) {
      const sampleTimecodeMs = Math.floor((s.pts / (s.timescale || 1000)) * 1000);
      const relativeTimecode = Math.max(-32768, Math.min(32767, sampleTimecodeMs - clusterTimecodeMs));

      // SimpleBlock header: TrackNumber (VINT) + Timecode (Int16 BE) + Flags (1 byte)
      const trackVint = writeVint(s.trackId);
      const blockHeader = new Uint8Array(trackVint.length + 3);
      blockHeader.set(trackVint, 0);

      const view = new DataView(blockHeader.buffer);
      view.setInt16(trackVint.length, relativeTimecode, false);

      // Flags: Keyframe (0x80) | Invisible (0x08) | Lacing (0x00) | Discardable (0x01)
      const flags = s.isKeyframe ? 0x80 : 0x00;
      blockHeader[trackVint.length + 2] = flags;

      const payload = new Uint8Array(blockHeader.byteLength + s.data.byteLength);
      payload.set(blockHeader, 0);
      payload.set(s.data, blockHeader.byteLength);

      clusterWriter.writeElement(0xa3, payload);
    }

    const clusterElement = new EbmlWriter();
    clusterElement.writeElement(0x1f43b675, clusterWriter.toUint8Array());
    return clusterElement.toUint8Array();
  }
}
