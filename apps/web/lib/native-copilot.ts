/**
 * Local Natural-Language Action Copilot (PDFgear-style) for MUXARO Desktop & Mobile Apps.
 * Executes workflows strictly offline on-device with zero cloud LLM calls.
 */

export interface CopilotAction {
  id: string;
  label: string;
  subtitle: string;
  kind: 'route' | 'drive' | 'screen';
  href?: string;
}

interface IntentRule {
  id: string;
  label: string;
  subtitle: string;
  kind: 'route' | 'drive' | 'screen';
  href?: string;
  patterns: RegExp[];
}

const INTENT_RULES: IntentRule[] = [
  {
    id: 'drive',
    label: 'Import from Google Drive',
    subtitle: 'Open Drive link importer',
    kind: 'drive',
    patterns: [/google drive/i, /\bdrive\b/i, /\bgdrive\b/i, /import.*cloud/i],
  },
  {
    id: 'screen',
    label: 'Capture Screen to PDF',
    subtitle: 'Screenshot desktop straight to PDF',
    kind: 'screen',
    patterns: [/screen\s*shot/i, /screen\s*capture/i, /capture\s*screen/i, /snip/i],
  },
  {
    id: 'read-pdf',
    label: 'Read & Inspect PDF',
    subtitle: 'Day / Sepia / Night modes & outline viewer',
    kind: 'route',
    href: '/tools/pdf/view?handoff=1',
    patterns: [/\bread\b.*pdf/i, /\bview\b.*pdf/i, /dark\s*mode/i, /night\s*mode/i, /sepia/i],
  },
  {
    id: 'compare-pdf',
    label: 'Compare Two PDFs',
    subtitle: 'Pixel & word diff side-by-side',
    kind: 'route',
    href: '/tools/pdf/compare?handoff=1',
    patterns: [/compare/i, /\bdiff\b/i],
  },
  {
    id: 'word-to-pdf',
    label: 'Word (.docx) to PDF',
    subtitle: 'Convert Word document locally',
    kind: 'route',
    href: '/tools/pdf/word-to-pdf?handoff=1',
    patterns: [/word.*pdf/i, /docx.*pdf/i],
  },
  {
    id: 'camera',
    label: 'Camera -> PDF Scanner',
    subtitle: 'Snap pages with Magic Color & B&W filters',
    kind: 'route',
    href: '/tools/pdf/make-pdf',
    patterns: [/camera/i, /\bscan\b/i, /photo.*pdf/i, /take.*pic/i, /document.*scan/i],
  },
  {
    id: 'compress-pdf',
    label: 'Compress PDF',
    subtitle: 'Shrink PDF size locally via QPDF',
    kind: 'route',
    href: '/tools/pdf/compress?handoff=1',
    patterns: [/(compress|shrink|smaller|reduce|optimize).*pdf/i, /pdf.*(compress|shrink|small)/i],
  },
  {
    id: 'merge-pdf',
    label: 'Merge PDFs',
    subtitle: 'Combine & reorder files or pages',
    kind: 'route',
    href: '/tools/pdf/merge?handoff=1',
    patterns: [/(merge|combine|join).*pdf/i, /\bmerge\b/i, /\bcombine\b/i],
  },
  {
    id: 'sign-pdf',
    label: 'Sign PDF',
    subtitle: 'Draw, type, or stamp signature',
    kind: 'route',
    href: '/tools/pdf/sign?handoff=1',
    patterns: [/\bsign\b/i, /signature/i, /autograph/i],
  },
  {
    id: 'edit-pdf',
    label: 'Edit & Redact PDF',
    subtitle: 'Edit text, highlight, redact permanently',
    kind: 'route',
    href: '/tools/pdf/edit?handoff=1',
    patterns: [/\bedit\b.*pdf/i, /\bredact/i, /\bannotate/i, /highlight/i],
  },
  {
    id: 'split-pdf',
    label: 'Split PDF',
    subtitle: 'Cut by size, chapters, or QR separator',
    kind: 'route',
    href: '/tools/pdf/split?handoff=1',
    patterns: [/\bsplit\b/i, /separate.*page/i, /extract.*chapter/i],
  },
  {
    id: 'pdf-to-word',
    label: 'PDF to Word (.docx)',
    subtitle: 'Convert PDF locally to editable Word',
    kind: 'route',
    href: '/tools/pdf/pdf-to-word?handoff=1',
    patterns: [/pdf.*word/i, /to\s*docx/i, /word\s*doc/i],
  },
  {
    id: 'ocr-pdf',
    label: 'Searchable OCR',
    subtitle: 'Recognize text locally via Tesseract',
    kind: 'route',
    href: '/tools/pdf/ocr?handoff=1',
    patterns: [/\bocr\b/i, /recognize\s*text/i, /extract\s*text/i, /searchable/i],
  },
  {
    id: 'protect-pdf',
    label: 'Lock / Protect PDF',
    subtitle: 'Encrypt with AES-256 password',
    kind: 'route',
    href: '/tools/pdf/protect?handoff=1',
    patterns: [/\block\b/i, /password/i, /encrypt/i, /protect/i],
  },
  {
    id: 'unlock-pdf',
    label: 'Unlock PDF',
    subtitle: 'Decrypt protected PDF locally',
    kind: 'route',
    href: '/tools/pdf/unlock?handoff=1',
    patterns: [/unlock/i, /decrypt/i, /remove\s*password/i],
  },
  {
    id: 'compress-video',
    label: 'Compress Video (10 MB / 16 MB)',
    subtitle: 'Exact Discord/WhatsApp bitrate target',
    kind: 'route',
    href: '/tools/video-compressor?handoff=1',
    patterns: [/(compress|shrink|10\s*mb|16\s*mb|discord|whatsapp).*video/i, /\bcompress\b.*mp4/i, /\bdiscord\b/i],
  },
  {
    id: 'trim-video',
    label: 'Trim Video',
    subtitle: '1s lossless cut or 60s Reels split',
    kind: 'route',
    href: '/tools/video-trimmer?handoff=1',
    patterns: [/\btrim\b/i, /\bcut\b.*video/i, /60s/i, /clip/i],
  },
  {
    id: 'extract-audio',
    label: 'Extract Audio (MP3 / FLAC)',
    subtitle: 'Strip crisp audio locally',
    kind: 'route',
    href: '/tools/audio-extractor?handoff=1',
    patterns: [/extract.*audio/i, /video.*mp3/i, /\bmp3\b/i, /\bflac\b/i, /rip\s*audio/i],
  },
  {
    id: 'video-gif',
    label: 'Video to GIF / WebP',
    subtitle: 'Animated clip loop locally',
    kind: 'route',
    href: '/tools/video-to-gif?handoff=1',
    patterns: [/\bgif\b/i, /animated\s*webp/i, /sticker/i],
  },
  {
    id: 'normalize-audio',
    label: 'Normalize Loudness (-14 LUFS)',
    subtitle: 'EBU R128 broadcast calibration',
    kind: 'route',
    href: '/tools/audio-normalizer?handoff=1',
    patterns: [/normaliz/i, /\blufs\b/i, /loudness/i, /volume/i],
  },
];

export function matchCopilotActions(query: string): CopilotAction[] {
  const clean = query.trim();
  if (!clean || /^https?:\/\//i.test(clean)) return [];

  const matched: CopilotAction[] = [];
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((re) => re.test(clean))) {
      matched.push({
        id: rule.id,
        label: rule.label,
        subtitle: rule.subtitle,
        kind: rule.kind,
        href: rule.href,
      });
    }
  }
  return matched.slice(0, 4);
}
