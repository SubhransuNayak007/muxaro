'use client';

import React from 'react';
import dynamic from 'next/dynamic';

function PdfWorkspaceSkeleton() {
  return (
    <div className="max-w-sheet mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="rounded-2xl border border-line bg-surface p-8 space-y-4">
        <div className="h-5 w-44 rounded bg-surface-elevated" />
        <div className="h-3 w-72 rounded bg-surface-elevated" />
        <div className="h-44 w-full rounded-xl border border-dashed border-line bg-surface-elevated/50" />
      </div>
    </div>
  );
}

const BusinessDocWorkspace = dynamic(() => import('./BusinessDocWorkspace'), {
  ssr: false,
  loading: () => <PdfWorkspaceSkeleton />,
});
const PdfCanvasViewer = dynamic(() => import('./PdfCanvasViewer'), {
  ssr: false,
  loading: () => <PdfWorkspaceSkeleton />,
});
const PdfCompareWorkspace = dynamic(() => import('./PdfCompareWorkspace'), {
  ssr: false,
  loading: () => <PdfWorkspaceSkeleton />,
});
const PdfEditorWorkspace = dynamic(() => import('./PdfEditorWorkspace'), {
  ssr: false,
  loading: () => <PdfWorkspaceSkeleton />,
});
const PdfFillableWorkspace = dynamic(() => import('./PdfFillableWorkspace'), {
  ssr: false,
  loading: () => <PdfWorkspaceSkeleton />,
});
const PdfSignWorkspace = dynamic(() => import('./PdfSignWorkspace'), {
  ssr: false,
  loading: () => <PdfWorkspaceSkeleton />,
});

const PdfCropTool = dynamic(
  () => import('./PdfOrganizeTools').then((m) => m.PdfCropTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfDeletePagesTool = dynamic(
  () => import('./PdfOrganizeTools').then((m) => m.PdfDeletePagesTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfExtractPagesTool = dynamic(
  () => import('./PdfOrganizeTools').then((m) => m.PdfExtractPagesTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfMergeTool = dynamic(
  () => import('./PdfOrganizeTools').then((m) => m.PdfMergeTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfRemoveBlankPagesTool = dynamic(
  () => import('./PdfOrganizeTools').then((m) => m.PdfRemoveBlankPagesTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfReorderPagesTool = dynamic(
  () => import('./PdfOrganizeTools').then((m) => m.PdfReorderPagesTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfRotatePagesTool = dynamic(
  () => import('./PdfOrganizeTools').then((m) => m.PdfRotatePagesTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfSplitTool = dynamic(
  () => import('./PdfOrganizeTools').then((m) => m.PdfSplitTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);

const PdfCompressTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfCompressTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfFlattenTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfFlattenTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfHeaderFooterTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfHeaderFooterTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfMetadataTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfMetadataTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfPageNumbersTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfPageNumbersTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfProtectTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfProtectTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfRemoveAnnotationsTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfRemoveAnnotationsTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfRemoveMetadataTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfRemoveMetadataTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfRepairTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfRepairTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfSanitizeTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfSanitizeTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfUnlockTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfUnlockTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfVerifySignaturesTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfVerifySignaturesTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfWatermarkTool = dynamic(
  () => import('./PdfStyleAndSecurityTools').then((m) => m.PdfWatermarkTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);

const PdfBatchTool = dynamic(
  () => import('./PdfConvertAndBatchTools').then((m) => m.PdfBatchTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfExtractImagesTool = dynamic(
  () => import('./PdfConvertAndBatchTools').then((m) => m.PdfExtractImagesTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfImageToPdfTool = dynamic(
  () => import('./PdfConvertAndBatchTools').then((m) => m.PdfImageToPdfTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfMakeFromCameraTool = dynamic(
  () => import('./PdfConvertAndBatchTools').then((m) => m.PdfMakeFromCameraTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfOcrTool = dynamic(
  () => import('./PdfConvertAndBatchTools').then((m) => m.PdfOcrTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfPptxToPdfTool = dynamic(
  () => import('./PdfConvertAndBatchTools').then((m) => m.PdfPptxToPdfTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfToImageTool = dynamic(
  () => import('./PdfConvertAndBatchTools').then((m) => m.PdfToImageTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfToWordTool = dynamic(
  () => import('./PdfConvertAndBatchTools').then((m) => m.PdfToWordTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);
const PdfWordToPdfTool = dynamic(
  () => import('./PdfConvertAndBatchTools').then((m) => m.PdfWordToPdfTool),
  { ssr: false, loading: () => <PdfWorkspaceSkeleton /> }
);

export default function PdfToolRenderer({ slug }: { slug: string }) {
  switch (slug) {
    case 'invoice':
      return <BusinessDocWorkspace kind="invoice" currentHref="/tools/pdf/invoice" />;
    case 'receipt':
      return <BusinessDocWorkspace kind="receipt" currentHref="/tools/pdf/receipt" />;
    case 'quote':
      return <BusinessDocWorkspace kind="quote" currentHref="/tools/pdf/quote" />;
    case 'view':
      return <PdfCanvasViewer />;
    case 'merge':
      return <PdfMergeTool />;
    case 'split':
      return <PdfSplitTool />;
    case 'edit':
      return <PdfEditorWorkspace />;
    case 'make-fillable':
      return <PdfFillableWorkspace />;
    case 'sign':
      return <PdfSignWorkspace />;
    case 'watermark':
      return <PdfWatermarkTool />;
    case 'delete-pages':
      return <PdfDeletePagesTool />;
    case 'page-numbers':
      return <PdfPageNumbersTool />;
    case 'reorder':
      return <PdfReorderPagesTool />;
    case 'rotate':
      return <PdfRotatePagesTool />;
    case 'extract':
      return <PdfExtractPagesTool />;
    case 'crop':
      return <PdfCropTool />;
    case 'header-footer':
      return <PdfHeaderFooterTool />;
    case 'compress':
      return <PdfCompressTool />;
    case 'flatten':
      return <PdfFlattenTool />;
    case 'repair':
      return <PdfRepairTool />;
    case 'compare':
      return <PdfCompareWorkspace />;
    case 'remove-blank-pages':
      return <PdfRemoveBlankPagesTool />;
    case 'batch':
      return <PdfBatchTool />;
    case 'make-pdf':
      return <PdfMakeFromCameraTool />;
    case 'image-to-pdf':
      return <PdfImageToPdfTool />;
    case 'pdf-to-jpg':
      return <PdfToImageTool />;
    case 'pdf-to-word':
      return <PdfToWordTool />;
    case 'word-to-pdf':
      return <PdfWordToPdfTool />;
    case 'powerpoint-to-pdf':
      return <PdfPptxToPdfTool />;
    case 'ocr':
      return <PdfOcrTool />;
    case 'extract-images':
      return <PdfExtractImagesTool />;
    case 'verify-signatures':
      return <PdfVerifySignaturesTool />;
    case 'protect':
      return <PdfProtectTool />;
    case 'unlock':
      return <PdfUnlockTool />;
    case 'metadata':
      return <PdfMetadataTool />;
    case 'remove-metadata':
      return <PdfRemoveMetadataTool />;
    case 'remove-annotations':
      return <PdfRemoveAnnotationsTool />;
    case 'sanitize':
      return <PdfSanitizeTool />;
    default:
      return <PdfCanvasViewer />;
  }
}
