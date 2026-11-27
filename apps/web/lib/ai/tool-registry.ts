import { ALL_STUDIO_TOOLS, CREATOR_TOOLS_CATALOG, PDF_TOOLS_CATALOG, type StudioToolMeta } from '../tools-catalog.ts';

export type ExecutionTier = 'tier0_local' | 'native_ffmpeg' | 'local_slm' | 'byok_cloud';
export type ToolRiskLevel = 'low' | 'moderate' | 'high';

export interface RegisteredToolSpec {
  id: string;
  href: string;
  suite: 'pdf' | 'video';
  plainTitle: string;
  description: string;
  category: string;
  executionTier: ExecutionTier;
  offlineCapable: boolean;
  riskLevel: ToolRiskLevel;
  requiresConfirmation: boolean;
  acceptedExtensions: string[];
  outputFormat: string;
  keywords: string[];
}

const PDF_EXTS = ['.pdf'];
const MEDIA_EXTS = ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.flv', '.mp3', '.flac', '.wav', '.m4a', '.aac', '.opus'];

const HIGH_RISK_IDS = new Set(['redact', 'delete-pages', 'remove-blank', 'protect', 'sanitize', 'strip-metadata', 'metadata-scrubber']);
const MODERATE_RISK_IDS = new Set([
  'compress', 'merge', 'split', 'rotate', 'reorder', 'watermark', 'page-numbers', 'edit', 'sign', 'ocr',
  'video-compressor', 'video-trimmer', 'video-merger', 'media-converter', 'audio-extractor',
]);

function toSpec(tool: StudioToolMeta, suite: 'pdf' | 'video'): RegisteredToolSpec {
  const id = tool.href.split('/').filter(Boolean).pop() || tool.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const riskLevel: ToolRiskLevel = HIGH_RISK_IDS.has(id)
    ? 'high'
    : MODERATE_RISK_IDS.has(id)
      ? 'moderate'
      : 'low';

  return {
    id,
    href: tool.href,
    suite,
    plainTitle: tool.title,
    description: tool.description,
    category: tool.category,
    executionTier: suite === 'video' ? 'native_ffmpeg' : 'tier0_local',
    offlineCapable: true,
    riskLevel,
    requiresConfirmation: riskLevel === 'high',
    acceptedExtensions:
      id === 'word-to-pdf'
        ? ['.docx']
        : id === 'powerpoint-to-pdf'
          ? ['.pptx', '.odp']
          : id === 'image-to-pdf' || id === 'make-pdf'
            ? ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.svg']
            : suite === 'video'
              ? MEDIA_EXTS
              : PDF_EXTS,
    outputFormat:
      id === 'word-to-docx' || id === 'pdf-to-word'
        ? '.docx'
        : id === 'pdf-to-jpg'
          ? '.jpg / .zip'
          : id === 'audio-extractor' || id === 'audio-normalizer'
            ? '.mp3 / .flac'
            : suite === 'video'
              ? '.mp4 / .mkv'
              : '.pdf',
    keywords: tool.keywords,
  };
}

export const UNIFIED_52_TOOL_REGISTRY: RegisteredToolSpec[] = [
  ...PDF_TOOLS_CATALOG.map((t) => toSpec(t, 'pdf')),
  ...CREATOR_TOOLS_CATALOG.map((t) => toSpec(t, 'video')),
];

export function findToolInRegistry(queryOrHref: string): RegisteredToolSpec | undefined {
  const q = queryOrHref.trim().toLowerCase();
  if (!q) return undefined;
  return (
    UNIFIED_52_TOOL_REGISTRY.find((t) => t.href.toLowerCase() === q || t.id === q) ||
    UNIFIED_52_TOOL_REGISTRY.find(
      (t) => t.plainTitle.toLowerCase().includes(q) || t.keywords.some((k) => k.toLowerCase() === q)
    )
  );
}

export function getRegistryCount(): number {
  return ALL_STUDIO_TOOLS.length;
}
