import assert from 'node:assert';
import {
  detectImageSignatureFromBytes,
  isFormatNativelyDecodable,
  validateBatchOrder,
  type ImageIngestState,
} from '../pdf/image-pipeline.ts';
import { classifyMediaSourceUrl, planMediaConversion } from '../media/source-resolver.ts';
import {
  buildRagSpaceIndex,
  buildTier0ExtractiveAnswer,
  queryRagSpace,
} from '../ai/local-rag.ts';
import { UNIFIED_52_TOOL_REGISTRY, getRegistryCount } from '../ai/tool-registry.ts';
import { planRecipeFromPrompt } from '../ai/recipe-planner.ts';

function runImagePipelineTests() {
  console.log('=== TEST A/B: Image Signature & 20-Item Batch Ordering ===');
  assert.strictEqual(detectImageSignatureFromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'a.jpg'), 'jpeg');
  assert.strictEqual(detectImageSignatureFromBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'wrong.jpg'), 'png');
  assert.strictEqual(
    detectImageSignatureFromBytes(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 'c.webp'),
    'webp'
  );
  assert.strictEqual(
    detectImageSignatureFromBytes(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), 'IMG_001.HEIC'),
    'heic'
  );
  assert.strictEqual(detectImageSignatureFromBytes(new Uint8Array([]), 'empty.jpg'), 'empty');
  assert.strictEqual(isFormatNativelyDecodable('jpeg'), true);
  assert.strictEqual(isFormatNativelyDecodable('webp'), true);
  assert.strictEqual(isFormatNativelyDecodable('heic'), false);
  assert.strictEqual(isFormatNativelyDecodable('empty'), false);

  // 20-image batch containing 19 valid + 1 removed/corrupt preserves order of valid items
  const batch: Array<{ orderIndex: number; id: string; state: ImageIngestState }> = Array.from({ length: 20 }, (_, i) => ({
    orderIndex: i,
    id: `p-${i}`,
    state: i === 7 ? 'failed' : 'ready',
  }));
  const orderedWithFailure = validateBatchOrder(batch);
  assert.strictEqual(orderedWithFailure.length, 20);
  assert.strictEqual(orderedWithFailure[7].state, 'failed');
  assert.deepStrictEqual(
    orderedWithFailure.filter((x) => x.state === 'ready').map((x) => x.orderIndex),
    [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
  );
  console.log('✓ Image signature detection and 20-item partial-failure ordering passed.');
}

function runSourceResolverTests() {
  console.log('=== TEST D: Media URL Source Classifier & SSRF Guard ===');
  const yt = classifyMediaSourceUrl('https://youtu.be/dQw4w9WgXcQ');
  assert.strictEqual(yt.kind, 'youtube');
  assert.strictEqual(yt.directDownloadableOnClient, false);
  assert.ok(yt.blockedReason && yt.alternatives.length >= 2);

  const mp4 = classifyMediaSourceUrl('https://cdn.example.com/clips/sample-1080p.mp4');
  assert.strictEqual(mp4.kind, 'direct_media');
  assert.strictEqual(mp4.directDownloadableOnClient, true);

  const drive = classifyMediaSourceUrl('https://drive.google.com/file/d/1234567890abcdef/view');
  assert.strictEqual(drive.kind, 'cloud_storage');

  const web = classifyMediaSourceUrl('https://example.com/blog/physics-notes');
  assert.strictEqual(web.kind, 'webpage');
  assert.strictEqual(web.directDownloadableOnClient, false);

  const localSsrf = classifyMediaSourceUrl('http://127.0.0.1:8080/internal');
  assert.strictEqual(localSsrf.kind, 'invalid_or_restricted');

  const xssScheme = classifyMediaSourceUrl('javascript:alert(1)');
  assert.strictEqual(xssScheme.kind, 'invalid_or_restricted');
  console.log('✓ Media URL source classification passed.');
}

function runRagDeduplicationTests() {
  console.log('=== TEST RAG: Deduplication, Grounding & Insufficient Evidence ===');
  const docIr = {
    docId: 'doc-physics',
    fileName: 'Physics_Notes.pdf',
    pageCount: 3,
    scannedPages: [2],
    ocrProcessedPages: [2],
    medianFontSize: 12,
    indexedAt: Date.now(),
    blocks: [
      {
        id: 'b1',
        pageNumber: 1,
        sectionTitle: 'Chapter 1: Kinematics',
        text: 'Newton second law states that force equals mass times acceleration (F = m * a) measured in Newtons.',
        kind: 'paragraph' as const,
        columnIndex: 0,
        fontSize: 12,
        rects: [],
      },
      {
        id: 'b2',
        pageNumber: 3,
        sectionTitle: 'Chapter 3: Summary Repeat',
        text: 'Newton second law states that force equals mass times acceleration (F = m * a) measured in Newtons.',
        kind: 'paragraph' as const,
        columnIndex: 0,
        fontSize: 12,
        rects: [],
      },
      {
        id: 'b3',
        pageNumber: 2,
        sectionTitle: 'Chapter 2: Gravitation',
        text: 'Gravitational field near Earth surface averages 9.81 meters per second squared.',
        kind: 'paragraph' as const,
        columnIndex: 0,
        fontSize: 12,
        rects: [],
      },
    ],
  };

  const index = buildRagSpaceIndex('space-test', [docIr]);
  const cits = queryRagSpace(index, 'force mass newton', 5);
  assert.ok(cits.length >= 1);
  // Duplicate passage on Page 1 and Page 3 must be deduplicated cleanly
  assert.strictEqual(cits.length, 1);

  const ans = buildTier0ExtractiveAnswer(index, 'force mass newton', cits);
  assert.strictEqual(ans.citations.length, 1);
  assert.ok(ans.answer.includes('Page 1'));
  assert.ok(!ans.answer.includes('100% confidence'));

  const noMatchCits = queryRagSpace(index, 'photosynthesis chlorophyll chloroplast', 5);
  const noMatchAns = buildTier0ExtractiveAnswer(index, 'photosynthesis chlorophyll chloroplast', noMatchCits);
  assert.strictEqual(noMatchAns.insufficientEvidence, true);
  assert.strictEqual(noMatchAns.citations.length, 0);
  console.log('✓ RAG deduplication and grounded answer tests passed.');
}

function runMediaPlannerAndRegistryTests() {
  console.log('=== TEST MEDIA & AI REGISTRY: Remux vs Transcode & Multi-Step Planner ===');
  const remux = planMediaConversion({
    sourceFileName: 'lecture.mp4',
    targetContainer: 'mkv',
    targetType: 'video',
    requestedVideoCodec: 'copy',
  });
  assert.strictEqual(remux.method, 'remux');
  assert.ok(!remux.badgeLabel.includes('12x'));

  const transcode = planMediaConversion({
    sourceFileName: 'lecture.mp4',
    targetContainer: 'webm',
    targetType: 'video',
    requestedVideoCodec: 'copy',
  });
  assert.strictEqual(transcode.method, 'transcode');

  const unsupported = planMediaConversion({
    sourceFileName: 'podcast.mp3',
    targetContainer: 'mp4',
    targetType: 'video',
  });
  assert.strictEqual(unsupported.method, 'unsupported');

  assert.strictEqual(getRegistryCount(), 52);
  assert.strictEqual(UNIFIED_52_TOOL_REGISTRY.length, 52);
  const protectTool = UNIFIED_52_TOOL_REGISTRY.find((t) => t.id === 'protect');
  assert.strictEqual(protectTool?.requiresConfirmation, true);
  const sanitizeTool = UNIFIED_52_TOOL_REGISTRY.find((t) => t.id === 'sanitize');
  assert.strictEqual(sanitizeTool?.requiresConfirmation, true);

  const plan = planRecipeFromPrompt('run ocr, redact pii, add page numbers, and compress pdf');
  assert.deepStrictEqual(
    plan.map((s) => s.toolId),
    ['ocr_pdf', 'smart_redact_pii', 'add_page_numbers', 'compress_pdf']
  );
  console.log('✓ Media capability planner, 52-tool registry, and multi-step planner passed.');
}

runImagePipelineTests();
runSourceResolverTests();
runRagDeduplicationTests();
runMediaPlannerAndRegistryTests();
console.log('ALL WALKTHROUGH REGRESSION TESTS PASSED.');
