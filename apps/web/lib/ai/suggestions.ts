import type { DocumentLayoutIR } from './types';

export interface SmartSuggestionChip {
  id: string;
  label: string;
  kind: 'tool-action' | 'prompt' | 'route' | 'ocr' | 'pick-file';
  actionId?: 'summarize' | 'hide-info' | 'tables' | 'mindmap' | 'audio';
  promptText?: string;
  href?: string;
}

export interface AttachedMediaMeta {
  width?: number;
  height?: number;
  isHdr?: boolean;
  durationSec?: number;
}

export function generateDynamicFileSuggestions(params: {
  file: File | null;
  isPdf: boolean;
  layout?: DocumentLayoutIR | null;
  mediaMeta?: AttachedMediaMeta | null;
  isEncryptedPdf?: boolean;
  pastedUrl?: string;
}): SmartSuggestionChip[] {
  const { file, isPdf, layout, mediaMeta, isEncryptedPdf, pastedUrl } = params;

  if (pastedUrl && /^https?:\/\//i.test(pastedUrl)) {
    return [
      { id: 'url-best', label: 'Download Highest Quality', kind: 'prompt', promptText: pastedUrl },
      { id: 'url-audio', label: 'Download Audio (MP3)', kind: 'route', href: `/tools/audio-extractor?url=${encodeURIComponent(pastedUrl)}` },
      { id: 'url-trim', label: 'Download & Trim Clip', kind: 'route', href: `/tools/video-trimmer?url=${encodeURIComponent(pastedUrl)}` },
    ];
  }

  if (!file) {
    return [
      { id: 's-sum', label: 'Summarize a PDF', kind: 'tool-action', actionId: 'summarize' },
      { id: 's-hide', label: 'Hide personal info before sharing', kind: 'tool-action', actionId: 'hide-info' },
      { id: 's-vid', label: 'Shrink a video for WhatsApp', kind: 'route', href: '/tools/video-compressor' },
      { id: 's-scan', label: 'Scan paper with camera', kind: 'route', href: '/tools/pdf/make-pdf' },
    ];
  }

  if (isPdf) {
    if (isEncryptedPdf) {
      return [
        { id: 'p-unlock', label: 'Unlock Password PDF', kind: 'route', href: '/tools/pdf/unlock?handoff=1' },
        { id: 'p-view', label: 'Open in Reader', kind: 'route', href: '/tools/pdf/view?handoff=1' },
      ];
    }

    if (layout && layout.scannedPages.length > 0) {
      return [
        { id: 'p-ocr', label: 'Make Searchable (OCR)', kind: 'ocr' },
        { id: 'p-compress', label: 'Compress File Size', kind: 'prompt', promptText: 'compress balanced' },
        { id: 'p-hide', label: 'Hide Personal Info', kind: 'tool-action', actionId: 'hide-info' },
        { id: 'p-sum', label: 'Summarize this PDF', kind: 'tool-action', actionId: 'summarize' },
      ];
    }

    if (file.size > 5 * 1024 * 1024) {
      return [
        { id: 'p-big-cmp', label: 'Compress PDF', kind: 'prompt', promptText: 'compress balanced' },
        { id: 'p-hide', label: 'Hide Personal Info', kind: 'tool-action', actionId: 'hide-info' },
        { id: 'p-tbl', label: 'Extract Tables', kind: 'tool-action', actionId: 'tables' },
        { id: 'p-sum', label: 'Summarize PDF', kind: 'tool-action', actionId: 'summarize' },
      ];
    }

    return [
      { id: 'p-sum', label: 'Summarize this PDF', kind: 'tool-action', actionId: 'summarize' },
      { id: 'p-hide', label: 'Hide Personal Info', kind: 'tool-action', actionId: 'hide-info' },
      { id: 'p-tbl', label: 'Extract Tables', kind: 'tool-action', actionId: 'tables' },
      { id: 'p-audio', label: 'Audio Summary', kind: 'tool-action', actionId: 'audio' },
    ];
  }

  // Video / Audio
  const isAudio = /\.(mp3|wav|flac|aac|m4a|opus|ogg)$/i.test(file.name) || file.type.startsWith('audio/');
  if (isAudio) {
    return [
      { id: 'a-norm', label: 'Normalize Loudness (-14 LUFS)', kind: 'route', href: '/tools/audio-normalizer?handoff=1' },
      { id: 'a-trim', label: 'Trim Audio Clip', kind: 'route', href: '/tools/video-trimmer?handoff=1' },
      { id: 'a-conv', label: 'Convert Audio Format', kind: 'route', href: '/tools/media-converter?handoff=1' },
    ];
  }

  const w = mediaMeta?.width || 0;
  if (w >= 3840) {
    const resTag = w >= 11520 ? '12K' : w >= 7680 ? '8K' : '4K';
    return [
      { id: 'v-trim', label: `Lossless ${resTag} Trim`, kind: 'route', href: '/tools/video-trimmer?handoff=1' },
      { id: 'v-wa', label: 'Shrink for WhatsApp (16 MB)', kind: 'route', href: '/tools/video-compressor?handoff=1' },
      { id: 'v-conv', label: 'Downscale / Convert', kind: 'route', href: '/tools/media-converter?handoff=1' },
      { id: 'v-aud', label: 'Extract Lossless Audio', kind: 'route', href: '/tools/audio-extractor?handoff=1' },
    ];
  }

  return [
    { id: 'v-wa', label: 'Shrink for WhatsApp (16 MB)', kind: 'route', href: '/tools/video-compressor?handoff=1' },
    { id: 'v-trim', label: 'Lossless Trim', kind: 'route', href: '/tools/video-trimmer?handoff=1' },
    { id: 'v-aud', label: 'Extract MP3 Audio', kind: 'route', href: '/tools/audio-extractor?handoff=1' },
    { id: 'v-scrub', label: 'Remove Metadata', kind: 'route', href: '/tools/metadata-scrubber?handoff=1' },
  ];
}

export function getPostTaskFollowUps(isPdfOutput: boolean): SmartSuggestionChip[] {
  if (isPdfOutput) {
    return [
      { id: 'next-cmp', label: 'Compress Result', kind: 'prompt', promptText: 'compress balanced' },
      { id: 'next-pgn', label: 'Add Page Numbers', kind: 'prompt', promptText: 'add page numbers' },
      { id: 'next-hide', label: 'Hide Personal Info', kind: 'tool-action', actionId: 'hide-info' },
      { id: 'next-ask', label: 'Summarize Result', kind: 'tool-action', actionId: 'summarize' },
    ];
  }
  return [
    { id: 'next-v-cmp', label: 'Shrink for Sharing', kind: 'route', href: '/tools/video-compressor?handoff=1' },
    { id: 'next-v-aud', label: 'Extract Audio', kind: 'route', href: '/tools/audio-extractor?handoff=1' },
  ];
}
