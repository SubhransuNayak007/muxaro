export type PdfCategory = 'Create' | 'Edit' | 'Optimize' | 'Convert' | 'Secure';

export type PdfCompressMode =
  | 'less'
  | 'lossless'
  | 'balanced'
  | 'rasterize'
  | 'grayscale'
  | 'strip-images';

export type PdfPageSizePreset = 'auto' | 'a4' | 'letter';

export type PdfOutputFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'tiff';

export type BusinessDocKind = 'invoice' | 'receipt' | 'quote';

export type PdfStandardFontChoice = 'helvetica' | 'times' | 'courier';

export type GridPosition9 =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'tiled';

export interface PdfProcessResult {
  blob: Blob;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  elapsedMs: number;
  pageCount?: number;
  summary?: string;
  skippedCompression?: boolean;
  warnings?: string[];
}

export interface PdfPageInfo {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  textPreview?: string;
}

export interface PdfTextSpan {
  id: string;
  pageNumber: number;
  text: string;
  /** Normalized 0..1 coordinates from top-left */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  mappedFamily: PdfStandardFontChoice;
  modernSlug?: 'inter' | 'plus-jakarta-sans' | 'jetbrains-mono' | 'merriweather';
  fontWeight?: 400 | 600 | 700;
  ascentRatio?: number;
  bold: boolean;
  italic: boolean;
  color: string;
  bgColor?: string;
  bgSliceDataUrl?: string;
  baselineY?: number;
  blockId?: string;
  blockWidth?: number;
}

export interface PdfExistingLink {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  originalRect: [number, number, number, number];
  url: string;
  dest?: string;
}

export interface PdfExistingLinkEdit {
  id: string;
  pageNumber: number;
  originalRect: [number, number, number, number];
  url: string;
  deleted?: boolean;
}

export interface PdfInlineTextEdit {
  id: string;
  pageNumber: number;
  /** Original normalized rect to cover */
  x: number;
  y: number;
  width: number;
  height: number;
  originalText: string;
  newText: string;
  fontFamily: PdfStandardFontChoice;
  fontName?: string;
  modernSlug?: 'inter' | 'plus-jakarta-sans' | 'jetbrains-mono' | 'merriweather';
  fontWeight?: 400 | 600 | 700;
  ascentRatio?: number;
  fontSize: number;
  color: string;
  bgColor?: string;
  bgSliceDataUrl?: string;
  baselineY?: number;
  bold?: boolean;
  italic?: boolean;
  matchOriginalWidth?: boolean;
  blockWidth?: number;
}

export interface PdfFormFieldSpec {
  id: string;
  pageNumber: number;
  type: 'text' | 'multiline' | 'checkbox' | 'radio' | 'dropdown';
  name: string;
  /** Normalized 0..1 coordinates in visual top-left page space */
  x: number;
  y: number;
  width: number;
  height: number;
  required?: boolean;
  defaultValue?: string;
  checked?: boolean;
  options?: string[];
  radioGroup?: string;
  suggested?: boolean;
}

export interface PdfEditorOverlayElement {
  id: string;
  pageNumber: number;
  kind:
    | 'text'
    | 'rect'
    | 'ellipse'
    | 'line'
    | 'arrow'
    | 'redact'
    | 'whiteout'
    | 'link'
    | 'image'
    | 'signature';
  /** Normalized 0..1 coordinates in visual top-left page space */
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  linkUrl?: string;
  fontSize?: number;
  fontFamily?: PdfStandardFontChoice;
  color?: string;
  fillColor?: string;
  strokeWidth?: number;
  opacity?: number;
  imageDataUrl?: string;
}

export interface PdfExtractedImage {
  id: string;
  pageNumber: number;
  width: number;
  height: number;
  format: 'jpeg' | 'png';
  blob: Blob;
  url: string;
  fileName: string;
}

export interface PdfRawBufferEntry {
  id: string;
  category: 'image-stream' | 'font-program' | 'embedded-file' | 'xmp-metadata' | 'page-content';
  label: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  blob: Blob;
  url: string;
}

export interface PdfSignatureInfo {
  fieldName: string;
  signerName: string;
  issuer: string;
  reason?: string;
  location?: string;
  signingTime?: string;
  subFilter: string;
  digestAlgorithm: string;
  byteRange: [number, number, number, number] | null;
  byteRangeCoversWholeFile: boolean;
  hasLaterRevisions?: boolean;
  digestValid: boolean | null;
  cryptographicValid?: boolean | null;
  isSelfSigned?: boolean;
  serialNumber?: string;
  validFrom?: string;
  validTo?: string;
  hasTimestamp?: boolean;
  timestampTime?: string;
  status: 'valid-integrity' | 'tampered' | 'unverifiable';
  notes: string;
}

export interface PdfMetadataValues {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creationDate?: string;
  modificationDate?: string;
  pageCount: number;
  pdfVersion?: string;
  isEncrypted?: boolean;
}

export interface PdfFingerprintAudit {
  infoFields: Array<{ key: string; value: string }>;
  hasXmpMetadata: boolean;
  hasOpenAction: boolean;
  hasCatalogActions: boolean;
  javaScriptCount: number;
  embeddedFilesCount: number;
  commentAnnotationsCount: number;
  formWidgetsCount: number;
  thumbnailCount?: number;
  pieceInfoCount?: number;
  totalFingerprints: number;
}

export interface PdfDeepInspectionResult {
  headerVersion: string;
  catalogVersion?: string;
  effectiveVersion: string;
  pdfaConformance?: string | null;
  isEncrypted: boolean;
  encryptionInfo?: {
    filter?: string;
    keyBits?: number;
    revision?: number;
    allowPrint: boolean;
    allowPrintHighRes: boolean;
    allowCopy: boolean;
    allowModify: boolean;
    allowAnnotate: boolean;
    allowFillForms: boolean;
    allowAssemble: boolean;
  };
  fileSizeBytes: number;
  objectCount: number;
  pageCount: number;
  pageSizesSummary: string;
  hasMixedPageSizes: boolean;
  pages: Array<{
    pageNumber: number;
    widthPt: number;
    heightPt: number;
    widthMm: number;
    heightMm: number;
    widthIn: number;
    heightIn: number;
    paperName: string;
    rotation: number;
  }>;
  fonts: Array<{
    baseFont: string;
    cleanFamily: string;
    subtype: string;
    isSubset: boolean;
    isEmbedded: boolean;
    streamBytes: number;
    pages: number[];
  }>;
  scripts: Array<{
    location: string;
    code: string;
  }>;
}

export interface BookmarkSplitEntry {
  title: string;
  level: number;
  startPage: number;
  endPage: number;
}

export interface StyledWordToken {
  word: string;
  fontFamily: string;
  rawFontName: string;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
  xNorm: number;
  yNorm: number;
}

export interface FormattingDelta {
  pageNumber: number;
  textSample: string;
  changes: Array<
    | { kind: 'fontFamily'; from: string; to: string }
    | { kind: 'fontSize'; from: number; to: number; deltaPt: number }
    | { kind: 'bold'; from: boolean; to: boolean }
    | { kind: 'italic'; from: boolean; to: boolean }
  >;
}

export interface BusinessDocLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export type BusinessDocLabelKey =
  | 'docTitle'
  | 'from'
  | 'billTo'
  | 'date'
  | 'dueDate'
  | 'description'
  | 'qty'
  | 'price'
  | 'total'
  | 'subtotal'
  | 'tax'
  | 'notes';

export interface BusinessDocInput {
  kind: BusinessDocKind;
  templateSize?: 'a4' | 'letter' | 'a6' | 'thermal-80mm';
  documentNumber: string;
  issueDate: string;
  dueOrValidDate: string;
  currency: string;
  accentColor: string;
  senderName: string;
  senderEmail: string;
  senderAddress: string;
  senderTaxId?: string;
  recipientName: string;
  recipientEmail: string;
  recipientAddress: string;
  recipientTaxId?: string;
  items: BusinessDocLineItem[];
  taxPercent: number;
  taxMode?: 'standard' | 'gst-intra' | 'gst-inter' | 'vat' | 'sales-tax';
  discountAmount: number;
  discountType?: 'flat' | 'percent';
  shippingAmount?: number;
  notes: string;
  scopeOfWork?: string;
  termsAndConditions?: string;
  acceptanceSignature?: {
    enabled?: boolean;
    label?: string;
  };
  paymentMethod?: string;
  paymentReference?: string;
  statusStamp?: string;
  showPaidWatermark?: boolean;
  logoDataUrl?: string;
  customLabels?: Partial<Record<BusinessDocLabelKey, string>>;
}
