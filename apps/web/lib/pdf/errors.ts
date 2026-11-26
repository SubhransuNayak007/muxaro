export class PdfToolError extends Error {
  code: 'locked' | 'not-pdf' | 'corrupt' | 'memory' | 'aborted' | 'validation' | 'unknown';

  constructor(
    message: string,
    code: PdfToolError['code'] = 'unknown'
  ) {
    super(message);
    this.name = 'PdfToolError';
    this.code = code;
  }
}

export async function assertValidPdfFile(file: File): Promise<void> {
  if (!file || file.size === 0) {
    throw new PdfToolError('The selected file is empty (0 bytes).', 'validation');
  }
  const headBytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const headText = new TextDecoder('latin1').decode(headBytes);
  const trimmed = headText.trimStart().toLowerCase();
  if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
    throw new PdfToolError(
      `"${file.name}" is an HTML web page saved with a PDF extension, not a valid PDF document.`,
      'not-pdf'
    );
  }
  if (!headText.includes('%PDF-')) {
    throw new PdfToolError(
      `"${file.name}" does not start with a valid %PDF- header.`,
      'not-pdf'
    );
  }
}

export function classifyPdfError(err: unknown, fallbackFileName?: string): PdfToolError {
  if (err instanceof PdfToolError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new PdfToolError('Operation cancelled.', 'aborted');
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return new PdfToolError('Operation cancelled.', 'aborted');
  }

  const raw = err instanceof Error ? err.message : String(err || 'Unknown PDF error');
  const lower = raw.toLowerCase();
  const prefix = fallbackFileName ? `${fallbackFileName}: ` : '';

  if (
    lower.includes('encrypted') ||
    lower.includes('password') ||
    lower.includes('invalid password')
  ) {
    return new PdfToolError(
      `${prefix}This PDF is password-protected. Unlock it first or enter the correct password.`,
      'locked'
    );
  }
  if (
    lower.includes('invalid pdf') ||
    lower.includes('not a pdf') ||
    lower.includes('no pdf header')
  ) {
    return new PdfToolError(
      `${prefix}The file structure is not a valid PDF. Try the Repair PDF tool if the file is damaged.`,
      'corrupt'
    );
  }
  if (lower.includes('out of memory') || lower.includes('allocation')) {
    return new PdfToolError(
      `${prefix}The document exceeded available browser memory. Try splitting it into smaller parts first.`,
      'memory'
    );
  }

  return new PdfToolError(`${prefix}${raw}`, 'unknown');
}

export function sanitizeFilenameStem(raw: string, fallback = 'document'): string {
  const cleaned = raw
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}
