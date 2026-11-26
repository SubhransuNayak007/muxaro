import type { PdfStandardFontChoice } from './types.ts';

export type ModernFontSlug =
  | 'inter'
  | 'plus-jakarta-sans'
  | 'jetbrains-mono'
  | 'merriweather';

export interface MatchedPdfFont {
  cleanName: string;
  mappedFamily: PdfStandardFontChoice;
  modernSlug: ModernFontSlug;
  fontWeight: 400 | 600 | 700;
  bold: boolean;
  italic: boolean;
  cssFontFamily: string;
}

const FONT_CACHE_DB = 'muxaro-pdf-font-cache';
const FONT_CACHE_STORE = 'fonts';
const memoryFontCache = new Map<string, Uint8Array>();
const browserLoadedFaces = new Set<string>();

export function stripPdfSubsetPrefix(rawName: string): string {
  return (rawName || '').replace(/^[A-Z]{6}\+/, '').trim();
}

export function classifyPdfFont(rawName: string, styleFamily?: string): MatchedPdfFont {
  const cleanName = stripPdfSubsetPrefix(rawName);
  const desc = `${cleanName} ${styleFamily || ''}`.toLowerCase();

  const italic = /italic|oblique|\bpsmt.*o\b|slant/.test(desc);
  let fontWeight: 400 | 600 | 700 = 400;
  if (/bold|black|heavy|extrabold|ultrabold|\bpsmt-?b\b/.test(desc) && !/semibold|demibold/.test(desc)) {
    fontWeight = 700;
  } else if (/semibold|demibold|medium|\b600\b|\b500\b/.test(desc)) {
    fontWeight = 600;
  }
  const bold = fontWeight >= 600;

  let mappedFamily: PdfStandardFontChoice = 'helvetica';
  if (
    /courier|mono|consola|menlo|monaco|lucida\s*console|dejavu\s*sans\s*mono|inconsolata|fira\s*code|jetbrains|source\s*code|cascadia|sf\s*mono/.test(
      desc
    ) ||
    styleFamily === 'monospace'
  ) {
    mappedFamily = 'courier';
  } else if (
    (/times|serif|georgia|garamond|palatino|cambria|minion|baskerville|book\s*antiqua|century|merriweather|lora|playfair|source\s*serif/.test(
      desc
    ) &&
      !/sans-?serif/.test(desc)) ||
    styleFamily === 'serif'
  ) {
    mappedFamily = 'times';
  }

  let modernSlug: ModernFontSlug = 'inter';
  if (mappedFamily === 'courier') {
    modernSlug = 'jetbrains-mono';
  } else if (mappedFamily === 'times') {
    modernSlug = 'merriweather';
  } else if (/jakarta|plus\s*jakarta|poppins|montserrat|outfit|dm\s*sans|manrope|figtree|geist|avenir|futura|gilroy/.test(desc)) {
    modernSlug = 'plus-jakarta-sans';
  } else {
    modernSlug = 'inter';
  }

  return {
    cleanName: cleanName || styleFamily || 'sans-serif',
    mappedFamily,
    modernSlug,
    fontWeight,
    bold,
    italic,
    cssFontFamily: buildCssFontStack(modernSlug, mappedFamily),
  };
}

export function buildCssFontStack(
  modernSlug: ModernFontSlug | string | undefined,
  fallbackChoice: PdfStandardFontChoice
): string {
  if (modernSlug === 'plus-jakarta-sans') {
    return '"MuxaroPlusJakartaSans", "Plus Jakarta Sans", "MuxaroInter", Inter, Arial, sans-serif';
  }
  if (modernSlug === 'jetbrains-mono') {
    return '"MuxaroJetBrainsMono", "JetBrains Mono", "Courier New", Courier, monospace';
  }
  if (modernSlug === 'merriweather') {
    return '"MuxaroMerriweather", Merriweather, "Times New Roman", Times, Georgia, serif';
  }
  if (modernSlug === 'inter') {
    return '"MuxaroInter", Inter, Arial, Helvetica, sans-serif';
  }
  if (fallbackChoice === 'times') {
    return '"Times New Roman", Times, Georgia, serif';
  }
  if (fallbackChoice === 'courier') {
    return '"Courier New", Courier, monospace';
  }
  return '"MuxaroInter", Inter, Arial, Helvetica, sans-serif';
}

function browserFaceNameForSlug(slug: ModernFontSlug): string {
  switch (slug) {
    case 'plus-jakarta-sans':
      return 'MuxaroPlusJakartaSans';
    case 'jetbrains-mono':
      return 'MuxaroJetBrainsMono';
    case 'merriweather':
      return 'MuxaroMerriweather';
    case 'inter':
    default:
      return 'MuxaroInter';
  }
}

export function resolveVendorFontUrl(
  slug: ModernFontSlug,
  weight: 400 | 600 | 700,
  italic: boolean
): string {
  const style = italic ? 'italic' : 'normal';
  return `/vendor/fonts/${slug}/${slug}-latin-${weight}-${style}.woff`;
}

async function readFontFromIdb(key: string): Promise<Uint8Array | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    return await new Promise<Uint8Array | null>((resolve) => {
      const req = indexedDB.open(FONT_CACHE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(FONT_CACHE_STORE)) {
          req.result.createObjectStore(FONT_CACHE_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(FONT_CACHE_STORE, 'readonly');
          const getReq = tx.objectStore(FONT_CACHE_STORE).get(key);
          getReq.onsuccess = () => {
            const val = getReq.result;
            resolve(val instanceof Uint8Array ? val : val instanceof ArrayBuffer ? new Uint8Array(val) : null);
          };
          getReq.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeFontToIdb(key: string, bytes: Uint8Array): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(FONT_CACHE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(FONT_CACHE_STORE)) {
          req.result.createObjectStore(FONT_CACHE_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(FONT_CACHE_STORE, 'readwrite');
          tx.objectStore(FONT_CACHE_STORE).put(bytes, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    });
  } catch {
    // Non-fatal IDB write error
  }
}

export async function loadMatchedFontBytes(
  slug: ModernFontSlug,
  weight: 400 | 600 | 700,
  italic: boolean
): Promise<Uint8Array | null> {
  const url = resolveVendorFontUrl(slug, weight, italic);
  const cachedMem = memoryFontCache.get(url);
  if (cachedMem) return cachedMem;

  const cachedDb = await readFontFromIdb(url);
  if (cachedDb && cachedDb.byteLength > 100) {
    memoryFontCache.set(url, cachedDb);
    return cachedDb;
  }

  if (typeof fetch === 'undefined' || typeof window === 'undefined') {
    return null;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < 100) return null;
    memoryFontCache.set(url, bytes);
    void writeFontToIdb(url, bytes);
    return bytes;
  } catch {
    return null;
  }
}

export async function ensurePdfFontLoadedForBrowser(
  slug: ModernFontSlug | undefined,
  weight: 400 | 600 | 700 = 400,
  italic = false
): Promise<void> {
  if (!slug || typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  const cacheKey = `${slug}-${weight}-${italic ? 'italic' : 'normal'}`;
  if (browserLoadedFaces.has(cacheKey)) return;
  browserLoadedFaces.add(cacheKey);

  const bytes = await loadMatchedFontBytes(slug, weight, italic);
  if (!bytes) return;

  try {
    const face = new FontFace(browserFaceNameForSlug(slug), Uint8Array.from(bytes), {
      weight: String(weight),
      style: italic ? 'italic' : 'normal',
    });
    const loaded = await face.load();
    document.fonts.add(loaded);
  } catch {
    // Fallback gracefully to system CSS stack
  }
}
