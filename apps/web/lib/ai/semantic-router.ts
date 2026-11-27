import type { SemanticCandidate } from './intent-router.ts';

export interface SemanticRouteDefinition {
  id: string;
  suite: 'pdf' | 'video' | 'general';
  utterances: string[];
}

export const SEMANTIC_ROUTES: SemanticRouteDefinition[] = [
  {
    id: 'video-compressor',
    suite: 'video',
    utterances: [
      'shrink this video so it fits on whatsapp',
      'make the video file smaller for email or discord',
      'compress clip without ruining quality',
      'video is too big to upload reduce megabytes',
    ],
  },
  {
    id: 'video-trimmer',
    suite: 'video',
    utterances: [
      'cut out the boring part from the start',
      'keep only the highlight section between two timestamps',
      'trim this video clip cleanly',
      'shorten video to thirty seconds',
    ],
  },
  {
    id: 'audio-extractor',
    suite: 'video',
    utterances: [
      'rip the background music out as mp3',
      'save only the sound track from this video',
      'convert video into an audio file',
      'extract voice audio from clip',
    ],
  },
  {
    id: 'aspect-ratio-pad',
    suite: 'video',
    utterances: [
      'turn horizontal video into vertical reels or shorts',
      'reframe clip for tiktok or instagram 9:16',
      'change aspect ratio to vertical portrait',
    ],
  },
  {
    id: 'metadata-scrubber',
    suite: 'video',
    utterances: [
      'remove camera gps location before sharing video',
      'strip private metadata tags from clip',
      'clean identifying exif device details',
    ],
  },
  {
    id: 'redact',
    suite: 'pdf',
    utterances: [
      'hide my phone number aadhaar pan and bank card permanently',
      'black out private personal info before sending pdf',
      'mask sensitive contact details and addresses in document',
    ],
  },
  {
    id: 'compress',
    suite: 'pdf',
    utterances: [
      'make this pdf attachment smaller for upload',
      'reduce pdf file size under limit',
      'shrink scanned document size cleanly',
    ],
  },
  {
    id: 'ocr',
    suite: 'pdf',
    utterances: [
      'make scanned pages selectable and searchable text',
      'read text from camera photos inside pdf',
      'run ocr on image pdf',
    ],
  },
  {
    id: 'summarize',
    suite: 'pdf',
    utterances: [
      'give me the main takeaways and summary of this file',
      'what is this document saying in simple bullet points',
      'tldr key points and deadlines',
    ],
  },
];

type EmbedFn = (text: string) => Promise<number[]>;

let extractorPromise: Promise<EmbedFn | null> | null = null;
let encoderStatus: 'unloaded' | 'loading' | 'ready-webgpu' | 'ready-wasm' | 'fallback' = 'unloaded';
let cachedRouteVectors: Map<string, number[][]> | null = null;

export function getSemanticEncoderStatus(): string {
  return encoderStatus;
}

function dotCosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) sum += a[i] * b[i];
  return sum;
}

function lexicalSimilarity(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3)
    );
  const ta = tok(a);
  const tb = tok(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter += 1;
  return inter / Math.sqrt(ta.size * tb.size);
}

/**
 * Loads `Xenova/all-MiniLM-L6-v2` quantized (INT8 ~25MB, cached offline in browser Cache API).
 * Prefers WebGPU and transparently falls back to WASM or lexical scoring if offline before first cache.
 */
export async function getOfflineEmbeddingFn(allowModelDownload = true): Promise<EmbedFn | null> {
  if (typeof window === 'undefined') return null;
  if (extractorPromise) return extractorPromise;
  if (!allowModelDownload) return null;

  encoderStatus = 'loading';
  extractorPromise = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        device: hasWebGpu ? 'webgpu' : 'wasm',
        dtype: 'q8',
      });
      encoderStatus = hasWebGpu ? 'ready-webgpu' : 'ready-wasm';

      return async (text: string): Promise<number[]> => {
        const res = await pipe(text, { pooling: 'mean', normalize: true });
        return Array.from(res.data as Float32Array);
      };
    } catch {
      encoderStatus = 'fallback';
      return null;
    }
  })();

  return extractorPromise;
}

export async function scoreSemanticRoutes(
  query: string,
  suiteFilter?: 'pdf' | 'video',
  allowModelDownload = false
): Promise<SemanticCandidate[]> {
  const routes = suiteFilter
    ? SEMANTIC_ROUTES.filter((r) => r.suite === suiteFilter || r.suite === 'general')
    : SEMANTIC_ROUTES;

  const embed = await getOfflineEmbeddingFn(allowModelDownload);
  if (!embed) {
    // Fast zero-download lexical cosine fallback
    return routes
      .map((r) => ({
        id: r.id,
        score: Math.max(...r.utterances.map((u) => lexicalSimilarity(query, u))),
      }))
      .sort((a, b) => b.score - a.score);
  }

  if (!cachedRouteVectors) {
    cachedRouteVectors = new Map();
    for (const r of SEMANTIC_ROUTES) {
      const vecs: number[][] = [];
      for (const u of r.utterances) {
        vecs.push(await embed(u));
      }
      cachedRouteVectors.set(r.id, vecs);
    }
  }

  const qVec = await embed(query);
  return routes
    .map((r) => {
      const vecs = cachedRouteVectors!.get(r.id) || [];
      const best = vecs.reduce((mx, v) => Math.max(mx, dotCosine(qVec, v)), 0);
      return { id: r.id, score: Math.round(best * 1000) / 1000 };
    })
    .sort((a, b) => b.score - a.score);
}

export async function embedTextsOffline(texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return [];
  const embed = await getOfflineEmbeddingFn(false);
  if (!embed) return null;
  const out: number[][] = [];
  for (const t of texts) {
    out.push(await embed(t));
  }
  return out;
}
