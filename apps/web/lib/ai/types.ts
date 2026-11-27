export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutBlockKind = 'heading' | 'paragraph' | 'table' | 'list' | 'key-value';

export interface LayoutBlock {
  id: string;
  pageNumber: number;
  columnIndex: number;
  kind: LayoutBlockKind;
  text: string;
  fontSize: number;
  sectionTitle: string;
  rects: NormalizedRect[];
  isOcr?: boolean;
}

export interface DocumentLayoutIR {
  docId: string;
  fileName: string;
  pageCount: number;
  scannedPages: number[];
  ocrProcessedPages: number[];
  medianFontSize: number;
  blocks: LayoutBlock[];
  indexedAt: number;
}

export interface RagChunk {
  chunkId: string;
  docId: string;
  fileName: string;
  pageNumber: number;
  sectionTitle: string;
  text: string;
  rects: NormalizedRect[];
  terms: string[];
  termFreq: Record<string, number>;
  length: number;
}

export interface RagSpaceIndex {
  spaceId: string;
  docs: Array<{
    docId: string;
    fileName: string;
    pageCount: number;
    scannedPages: number[];
    ocrProcessedPages: number[];
    chunkCount: number;
  }>;
  chunks: RagChunk[];
  docFreq: Record<string, number>;
  avgChunkLen: number;
}

export interface CitationRef {
  id: string;
  docId: string;
  fileName: string;
  pageNumber: number;
  sectionTitle: string;
  snippet: string;
  score: number;
  rects: NormalizedRect[];
}

export type PiiCategory =
  | 'Credit / Debit Card'
  | 'IBAN'
  | 'SWIFT / BIC'
  | 'US SSN'
  | 'India Aadhaar'
  | 'India PAN'
  | 'Email Address'
  | 'Phone Number'
  | 'IPv4 Address'
  | 'IPv6 Address'
  | 'MAC Address'
  | 'API Key / Secret'
  | 'JWT Token'
  | 'Date of Birth'
  | 'Passport / Tax ID';

export interface PiiFinding {
  id: string;
  category: PiiCategory;
  severity: 'high' | 'medium';
  maskedPreview: string;
  rawMatch: string;
  pageNumber: number;
  rect: NormalizedRect;
  selected: boolean;
}

export interface ExtractedTable {
  id: string;
  pageNumber: number;
  title: string;
  headers: string[];
  rows: string[][];
  confidence: number;
  bounds: NormalizedRect;
}

export interface MindMapNode {
  id: string;
  label: string;
  pageNumber?: number;
  children: MindMapNode[];
}

export type AiEngineMode = 'tier0-offline' | 'local-slm' | 'lan-mesh' | 'byok-cloud';

export interface AiRuntimeStatus {
  mode: AiEngineMode;
  platform: 'desktop-exe' | 'android-apk' | 'web';
  ollamaAvailable: boolean;
  ollamaModels: string[];
  llamaServerAvailable: boolean;
  lmStudioAvailable: boolean;
  activeLocalModel?: string;
  lanMeshEnabled: boolean;
  lanMeshUrl?: string;
  byokConfigured: boolean;
  byokProvider?: 'gemini' | 'openai' | 'anthropic' | 'openrouter';
  androidNativeTts: boolean;
  androidLocalSlmReady: boolean;
  totalRamMb?: number;
}

export type AgentStepToolId =
  | 'ocr_pdf'
  | 'remove_blank_pages'
  | 'compress_pdf'
  | 'merge_pdfs'
  | 'split_pdf'
  | 'rotate_pages'
  | 'protect_pdf'
  | 'unlock_pdf'
  | 'smart_redact_pii'
  | 'extract_tables_csv'
  | 'add_watermark'
  | 'add_page_numbers'
  | 'auto_bookmark'
  | 'pdf_to_word'
  | 'pdf_to_images'
  | 'repair_pdf'
  | 'sanitize_metadata';

export interface AgentRecipeStep {
  id: string;
  toolId: AgentStepToolId;
  title: string;
  description: string;
  destructive: boolean;
  requiresInput?: 'password' | 'watermark-text' | 'degrees';
  params: Record<string, string | number | boolean>;
  status?: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
}

export interface ClarificationOption {
  id: string;
  label: string;
  promptText: string;
  entityId?: string;
}

export interface ThoughtTraceStep {
  label: string;
  status: 'done' | 'running' | 'info';
}

export interface CopilotExecutionResult {
  summary: string;
  outputFile?: File;
  extraTextExport?: { fileName: string; content: string; mimeType: string };
  steps: AgentRecipeStep[];
  elapsedMs: number;
}
