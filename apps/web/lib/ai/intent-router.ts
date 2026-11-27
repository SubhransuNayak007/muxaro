import { normalizeUserUtterance, type NormalizedUtterance } from './intent-normalizer.ts';
import {
  buildNextSmallerTargetMb,
  resolveContextualTargets,
  type WorkspaceEntity,
  type WorkspaceMemorySnapshot,
} from './workspace-memory.ts';
import { planRecipeFromPrompt } from './recipe-planner.ts';
import type { AgentRecipeStep, ClarificationOption, ThoughtTraceStep } from './types.ts';

export type QuickActionKind = 'summarize' | 'hide-info' | 'tables' | 'mindmap' | 'audio' | 'action-items';

export interface MediaPipelineStep {
  tool: 'compress' | 'trim' | 'extract_audio' | 'aspect' | 'normalizer' | 'scrub' | 'convert' | 'transcribe_to_notes_pdf';
  targetFormat: string;
  targetSizeMb?: number;
  startTime?: string;
  endTime?: string;
  aspectRatio?: string;
  summary: string;
}

export type ResolvedIntent =
  | {
      kind: 'url_probe';
      url: string;
      trace: ThoughtTraceStep[];
      confidence: number;
    }
  | {
      kind: 'small_talk';
      mode: 'greeting' | 'capabilities' | 'affirmation' | 'negation';
      trace: ThoughtTraceStep[];
      confidence: number;
    }
  | {
      kind: 'clarification';
      promptQuestion: string;
      options: ClarificationOption[];
      trace: ThoughtTraceStep[];
      confidence: number;
    }
  | {
      kind: 'create_document';
      trace: ThoughtTraceStep[];
      confidence: number;
    }
  | {
      kind: 'images_to_pdf';
      files: File[];
      withOcrAndSummary: boolean;
      trace: ThoughtTraceStep[];
      confidence: number;
    }
  | {
      kind: 'media_pipeline';
      targetFile: File;
      steps: MediaPipelineStep[];
      requiresHandshake: boolean;
      handshakePrompt?: string;
      trace: ThoughtTraceStep[];
      confidence: number;
    }
  | {
      kind: 'pdf_quick_action';
      action: QuickActionKind;
      targetFile?: File;
      needsOcrFirst: boolean;
      requiresHandshake: boolean;
      handshakePrompt?: string;
      trace: ThoughtTraceStep[];
      confidence: number;
    }
  | {
      kind: 'pdf_merge_recipe';
      files: File[];
      followSteps: AgentRecipeStep[];
      trace: ThoughtTraceStep[];
      confidence: number;
    }
  | {
      kind: 'pdf_recipe';
      targetFile?: File;
      steps: AgentRecipeStep[];
      requiresHandshake: boolean;
      trace: ThoughtTraceStep[];
      confidence: number;
    }
  | {
      kind: 'qa_or_chat';
      question: string;
      targetFile?: File;
      trace: ThoughtTraceStep[];
      confidence: number;
    };

export interface SemanticCandidate {
  id: string;
  score: number;
}

export interface IntentRoutingContext {
  rawText: string;
  normalized?: NormalizedUtterance;
  memory: WorkspaceMemorySnapshot;
  composerAttachments: File[];
  fromVoice?: boolean;
  semanticCandidates?: SemanticCandidate[];
}

function buildTrace(
  normalized: NormalizedUtterance,
  target?: WorkspaceEntity,
  extra: string[] = []
): ThoughtTraceStep[] {
  const steps: ThoughtTraceStep[] = [];
  for (const c of normalized.corrections) {
    steps.push({ label: `Adjusted "${c.from}" -> "${c.to}"`, status: 'done' });
  }
  if (normalized.hinglishDetected) {
    steps.push({ label: 'Understood bilingual / Hinglish request', status: 'done' });
  }
  if (target) {
    steps.push({ label: `Focused on ${target.file.name}`, status: 'done' });
  }
  for (const note of extra) {
    steps.push({ label: note, status: 'done' });
  }
  return steps;
}

export function resolveAgentIntent(ctx: IntentRoutingContext): ResolvedIntent {
  const normalized = ctx.normalized || normalizeUserUtterance(ctx.rawText);
  const text = normalized.normalizedEnglish;

  // 1. Direct URL pasted
  const urlMatch = normalized.raw.match(/https?:\/\/[^\s]+/i);
  if (urlMatch && (/^https?:\/\//i.test(normalized.raw) || /\b(download|save|get|grab|video|reel|audio)\b/i.test(text))) {
    return {
      kind: 'url_probe',
      url: urlMatch[0],
      trace: buildTrace(normalized, undefined, ['Inspecting highest-quality media streams']),
      confidence: 0.99,
    };
  }

  // 2. Conversational greetings, capabilities & short voice confirmations
  if (
    normalized.isAffirmation &&
    ctx.composerAttachments.length === 0
  ) {
    return {
      kind: 'small_talk',
      mode: 'affirmation',
      trace: buildTrace(normalized),
      confidence: 0.95,
    };
  }
  if (normalized.isNegation) {
    return {
      kind: 'small_talk',
      mode: 'negation',
      trace: buildTrace(normalized),
      confidence: 0.95,
    };
  }
  if (/^(hi|hello|hey|yo|sup|namaste|good\s*(?:morning|afternoon|evening)|how\s*are\s*you|thanks|thank\s*you)[!.\s]*$/i.test(normalized.cleaned)) {
    return {
      kind: 'small_talk',
      mode: 'greeting',
      trace: buildTrace(normalized),
      confidence: 0.99,
    };
  }
  if (/\b(what\s*can\s*you\s*do|help\s*me\s*plan|how\s*does\s*this\s*work|features|capabilities)\b/i.test(text) && ctx.memory.entities.length === 0) {
    return {
      kind: 'small_talk',
      mode: 'capabilities',
      trace: buildTrace(normalized),
      confidence: 0.95,
    };
  }

  // 3. Resolve target file(s) from WorkspaceMemory
  const resolution = resolveContextualTargets(normalized, ctx.memory);
  const extraNotes: string[] = [];
  if (resolution.resolutionNote) extraNotes.push(resolution.resolutionNote);

  // Ambiguous across multiple attached files of different domains? Ask 1-tap clarification instead of guessing!
  if (resolution.ambiguousEntities && resolution.ambiguousEntities.length > 1) {
    return {
      kind: 'clarification',
      promptQuestion: 'You have multiple files ready — which one should I work on?',
      options: resolution.ambiguousEntities.map((ent, idx) => ({
        id: `pick-ent-${idx}`,
        label: ent.file.name,
        promptText: `${normalized.cleaned} (${idx === 0 ? 'first' : idx === 1 ? 'second' : idx === 2 ? 'third' : 'last'} file)`,
        entityId: ent.id,
      })),
      trace: buildTrace(normalized, undefined, ['Multiple file types attached — asking which file to target']),
      confidence: 0.6,
    };
  }

  const primary = resolution.primary;
  const domain = primary?.domain;

  // 4. Handle follow-up tweaks to previous action ("make it smaller", "actually 10 MB", "try grayscale")
  if (normalized.isFollowUpTweak && ctx.memory.lastAction) {
    const prev = ctx.memory.lastAction;
    if ((prev.suite === 'video' || prev.suite === 'audio') && prev.toolId === 'compress' && primary) {
      const nextMb =
        normalized.extractedSizeMb ||
        buildNextSmallerTargetMb(typeof prev.params.targetSizeMb === 'number' ? prev.params.targetSizeMb : 16);
      return {
        kind: 'media_pipeline',
        targetFile: primary.file,
        steps: [
          {
            tool: 'compress',
            targetFormat: 'mp4',
            targetSizeMb: nextMb,
            summary: `Re-compressing ${primary.file.name} tighter to ${nextMb} MB`,
          },
        ],
        requiresHandshake: false,
        trace: buildTrace(normalized, primary, [`Adjusted previous compression target to ${nextMb} MB`]),
        confidence: 0.94,
      };
    }
    if (prev.suite === 'pdf' && prev.toolId === 'compress_pdf' && primary && /\b(smaller|tighter|grayscale|gray|lossless)\b/i.test(text)) {
      const mode = /\b(lossless)\b/i.test(text) ? 'lossless' : 'grayscale';
      return {
        kind: 'pdf_recipe',
        targetFile: primary.file,
        steps: [
          {
            id: 'step-1-compress_pdf',
            toolId: 'compress_pdf',
            title: `Compress PDF (${mode})`,
            description: `Re-run compression in ${mode} mode for tighter footprint`,
            destructive: false,
            params: { mode },
            status: 'pending',
          },
        ],
        requiresHandshake: false,
        trace: buildTrace(normalized, primary, [`Switched PDF compression to ${mode} mode`]),
        confidence: 0.93,
      };
    }
  }

  // 5. Image batch -> Validated PDF
  const attachedImages = ctx.composerAttachments.filter(
    (f) => f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp|svg|heic|tif|tiff)$/i.test(f.name)
  );
  if (attachedImages.length > 0 || (domain === 'image' && primary)) {
    const imgs = attachedImages.length > 0 ? attachedImages : [primary!.file];
    return {
      kind: 'images_to_pdf',
      files: imgs,
      withOcrAndSummary: /\b(ocr|searchable|summar|study|read|note|chapter|extract)\b/i.test(text),
      trace: buildTrace(normalized, primary, [`Bundling ${imgs.length} image(s) into PDF`]),
      confidence: 0.95,
    };
  }

  // 6. Create Document from Prompt (when not working inside an existing PDF edit)
  if (
    /\b(create|make|generate|write|build|draft)\b.*\b(invoice|quote|estimate|receipt|report|notes|letter|contract|pdf)\b/i.test(text) &&
    domain !== 'pdf'
  ) {
    return {
      kind: 'create_document',
      trace: buildTrace(normalized, undefined, ['Generating clean local PDF document from prompt']),
      confidence: 0.93,
    };
  }

  // 7. Media / Video / Audio Pipelines (including Multi-Step Media & Cross-Domain Media->PDF!)
  if (primary && (domain === 'video' || domain === 'audio')) {
    const steps: MediaPipelineStep[] = [];
    const wantsCrossNotesPdf =
      /\b(notes|pdf|transcript|transcribe|summarize\s*(?:it|this|to\s*pdf)|study\s*notes)\b/i.test(text);

    // Trim?
    if (/\b(trim|cut|clip|teaser|highlight|60s)\b/i.test(text) || normalized.extractedTimesSec.length >= 2) {
      steps.push({
        tool: 'trim',
        targetFormat: domain === 'audio' ? normalized.extractedFormat || 'mp3' : 'mp4',
        startTime: normalized.extractedTimesSec[0],
        endTime: normalized.extractedTimesSec[1],
        summary: normalized.extractedTimesSec[0]
          ? `Trimming clip (${normalized.extractedTimesSec[0]} -> ${normalized.extractedTimesSec[1] || 'end'})`
          : `Trimming ${primary.file.name}`,
      });
    }

    // Reframe / Aspect Ratio?
    if (normalized.extractedAspect || /\b(vertical|reels|shorts|tiktok|reframe)\b/i.test(text)) {
      const aspect = normalized.extractedAspect || '9:16';
      steps.push({
        tool: 'aspect',
        targetFormat: 'mp4',
        aspectRatio: aspect,
        summary: `Reframing video cleanly to ${aspect}`,
      });
    }

    // Compress / Shrink?
    if (/\b(whatsapp|discord|email\s*limit|bounced|too\s*big|huge|compress|shrink|smaller|reduce)\b/i.test(text)) {
      const hasExplicitPresetOrMb = Boolean(normalized.extractedSizeMb);
      if (!hasExplicitPresetOrMb && /\b(compress|shrink|smaller|reduce|too\s*big|bounced)\b/i.test(text) && steps.length === 0) {
        return {
          kind: 'clarification',
          promptQuestion: `How compact should I make **${primary.file.name}**?`,
          options: [
            { id: 'c-wa', label: 'WhatsApp (16 MB)', promptText: 'compress to 16 mb for whatsapp' },
            { id: 'c-dc', label: 'Discord (10 MB)', promptText: 'compress to 10 mb for discord' },
            { id: 'c-em', label: 'Email (25 MB)', promptText: 'compress to 25 mb' },
            { id: 'c-hq', label: 'High Quality (50 MB)', promptText: 'compress to 50 mb' },
          ],
          trace: buildTrace(normalized, primary, ['Compression target size unspecified — offering presets']),
          confidence: 0.78,
        };
      }
      const mb = normalized.extractedSizeMb || 16;
      steps.push({
        tool: 'compress',
        targetFormat: 'mp4',
        targetSizeMb: mb,
        summary: `Shrinking ${primary.file.name} to fit ${mb} MB`,
      });
    }

    // Loudness Normalize?
    if (/\b(volume|loudness|normaliz|lufs|quiet|louder|boost\s*audio)\b/i.test(text)) {
      steps.push({
        tool: 'normalizer',
        targetFormat: domain === 'audio' ? normalized.extractedFormat || 'mp3' : 'mp4',
        summary: 'Balancing loudness (-14 LUFS)',
      });
    }

    // Extract Audio?
    if (/\b(extract\s*audio|mp3|flac|wav|rip\s*audio|audio\s*only|podcast)\b/i.test(text) || wantsCrossNotesPdf) {
      const fmt =
        normalized.extractedFormat && ['mp3', 'flac', 'wav', 'aac', 'm4a'].includes(normalized.extractedFormat)
          ? normalized.extractedFormat
          : wantsCrossNotesPdf
            ? 'wav'
            : 'mp3';
      steps.push({
        tool: 'extract_audio',
        targetFormat: fmt,
        summary: `Extracting crisp ${fmt.toUpperCase()} audio track`,
      });
    }

    // Cross-domain Transcript -> PDF Notes?
    if (wantsCrossNotesPdf) {
      steps.push({
        tool: 'transcribe_to_notes_pdf',
        targetFormat: 'pdf',
        summary: 'Transcribing locally & compiling structured PDF notes',
      });
    }

    // Privacy / Scrub?
    const wantsScrub = /\b(scrub|privacy|metadata|location|exif|gps|strip\s*tags)\b/i.test(text);
    if (wantsScrub) {
      steps.push({
        tool: 'scrub',
        targetFormat: 'mp4',
        summary: 'Stripping private camera & GPS tags',
      });
    }

    // Format conversion?
    if (steps.length === 0 && /\b(convert|mkv|mov|webm|mp4)\b/i.test(text)) {
      const fmt = normalized.extractedFormat && ['mkv', 'mov', 'webm', 'mp4'].includes(normalized.extractedFormat)
        ? normalized.extractedFormat
        : 'mp4';
      steps.push({
        tool: 'convert',
        targetFormat: fmt,
        summary: `Converting to .${fmt.toUpperCase()}`,
      });
    }

    if (steps.length > 0) {
      const requiresHandshake = Boolean(ctx.fromVoice && wantsScrub && steps.length === 1);
      return {
        kind: 'media_pipeline',
        targetFile: primary.file,
        steps,
        requiresHandshake,
        handshakePrompt: requiresHandshake
          ? `Strip all camera & GPS tags from ${primary.file.name}?`
          : undefined,
        trace: buildTrace(normalized, primary, [
          `Planned ${steps.length} media step(s): ${steps.map((s) => s.tool).join(' -> ')}`,
        ]),
        confidence: 0.92,
      };
    }

    // Semantic Router Layer-2 check if no regex rule fired
    const topSem = ctx.semanticCandidates?.[0];
    if (topSem && topSem.score >= 0.56) {
      if (topSem.id === 'video-compressor') {
        return {
          kind: 'clarification',
          promptQuestion: `Did you want to shrink **${primary.file.name}**? Pick a preset:`,
          options: [
            { id: 'sem-wa', label: 'WhatsApp (16 MB)', promptText: 'compress to 16 mb for whatsapp' },
            { id: 'sem-dc', label: 'Discord (10 MB)', promptText: 'compress to 10 mb for discord' },
          ],
          trace: buildTrace(normalized, primary, [`Semantic router matched compression (${Math.round(topSem.score * 100)}%)`]),
          confidence: topSem.score,
        };
      }
      if (topSem.id === 'audio-extractor') {
        return {
          kind: 'media_pipeline',
          targetFile: primary.file,
          steps: [{ tool: 'extract_audio', targetFormat: 'mp3', summary: 'Extracting crisp MP3 audio track' }],
          requiresHandshake: false,
          trace: buildTrace(normalized, primary, [`Semantic router matched audio extraction (${Math.round(topSem.score * 100)}%)`]),
          confidence: topSem.score,
        };
      }
    }
  }

  // 8. Multi-PDF Merge + Follow-up Recipe
  const composerPdfs = ctx.composerAttachments.filter(
    (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
  );
  const workspacePdfs = ctx.memory.entities.filter((e) => e.domain === 'pdf' && !e.isOutput).map((e) => e.file);
  const mergePool = composerPdfs.length >= 2 ? composerPdfs : workspacePdfs.length >= 2 && normalized.ordinalRef === 'all' ? workspacePdfs : [];
  if (/\b(merge|combine|join)\b/i.test(text) && mergePool.length >= 2) {
    const followSteps = planRecipeFromPrompt(text).filter((s) => s.toolId !== 'merge_pdfs');
    return {
      kind: 'pdf_merge_recipe',
      files: mergePool,
      followSteps,
      trace: buildTrace(normalized, primary, [
        `Merging ${mergePool.length} PDFs${followSteps.length ? ` + ${followSteps.length} follow-up step(s)` : ''}`,
      ]),
      confidence: 0.95,
    };
  }

  // 9. Quick PDF Actions & Compound PDF Recipes (multi-step recipes always win over single shortcuts!)
  const scannedPages = primary?.pdfMeta?.scannedPagesCount || 0;
  const needsOcrFirst = Boolean(domain === 'pdf' && scannedPages > 0);
  const plannedSteps = planRecipeFromPrompt(text, { scannedPagesCount: scannedPages });
  const isCompoundRecipe = plannedSteps.length >= 2;

  if (!isCompoundRecipe && /\b(hide\s*personal|black\s*out|redact|sensitive\s*info|pii|(?:hide|remove)\s+(?:my\s+)?(?:phone|aadhaar|card|email))\b/i.test(text)) {
    return {
      kind: 'pdf_quick_action',
      action: 'hide-info',
      targetFile: primary?.file,
      needsOcrFirst,
      requiresHandshake: false, // hide-info itself opens review checklist before permanent burn
      trace: buildTrace(
        normalized,
        primary,
        needsOcrFirst ? [`Detected ${scannedPages} scanned page(s) — running OCR before scan`] : ['Scanning document for personal details']
      ),
      confidence: 0.96,
    };
  }

  if (!isCompoundRecipe && /\b(extract\s*tables?|to\s*csv|to\s*excel|spreadsheet|tabular)\b/i.test(text)) {
    return {
      kind: 'pdf_quick_action',
      action: 'tables',
      targetFile: primary?.file,
      needsOcrFirst,
      requiresHandshake: false,
      trace: buildTrace(normalized, primary, ['Scanning spatial column alignment for tables']),
      confidence: 0.95,
    };
  }

  if (!isCompoundRecipe && /\b(mind\s*map|topic\s*map|visual\s*outline|outline\s*tree)\b/i.test(text)) {
    return {
      kind: 'pdf_quick_action',
      action: 'mindmap',
      targetFile: primary?.file,
      needsOcrFirst,
      requiresHandshake: false,
      trace: buildTrace(normalized, primary, ['Building clickable topic hierarchy']),
      confidence: 0.95,
    };
  }

  if (!isCompoundRecipe && /\b(audio\s*(?:summary|briefing|overview)|listen|read\s*aloud|podcast)\b/i.test(text)) {
    return {
      kind: 'pdf_quick_action',
      action: 'audio',
      targetFile: primary?.file,
      needsOcrFirst,
      requiresHandshake: false,
      trace: buildTrace(normalized, primary, ['Preparing offline spoken briefing']),
      confidence: 0.95,
    };
  }

  if (!isCompoundRecipe && /\b(action\s*items|risks|deadlines|obligations|clauses)\b/i.test(text) && primary && domain === 'pdf') {
    return {
      kind: 'pdf_quick_action',
      action: 'action-items',
      targetFile: primary.file,
      needsOcrFirst,
      requiresHandshake: false,
      trace: buildTrace(normalized, primary, ['Extracting deadlines, risks & obligations']),
      confidence: 0.92,
    };
  }

  // Standalone Summarize request when a PDF is active
  if (
    !isCompoundRecipe &&
    /\b(summarize|summary|tldr|tl;dr|key\s*points|overview|main\s*takeaways|highlights)\b/i.test(text) &&
    primary &&
    domain === 'pdf'
  ) {
    return {
      kind: 'pdf_quick_action',
      action: 'summarize',
      targetFile: primary.file,
      needsOcrFirst,
      requiresHandshake: false,
      trace: buildTrace(
        normalized,
        primary,
        needsOcrFirst ? [`Detected ${scannedPages} scanned page(s) — auto-adding Searchable OCR`] : ['Running grounded multi-page summary']
      ),
      confidence: 0.95,
    };
  }

  // 10. Compound PDF Editing Recipe (with automatic scanned-page OCR insertion!)
  if (plannedSteps.length > 0) {
    const hasDestructive = plannedSteps.some((s) => s.destructive);
    return {
      kind: 'pdf_recipe',
      targetFile: primary?.file,
      steps: plannedSteps,
      requiresHandshake: Boolean(ctx.fromVoice && hasDestructive),
      trace: buildTrace(
        normalized,
        primary,
        [`Prepared ${plannedSteps.length}-step PDF plan${hasDestructive ? ' (confirmation gated)' : ''}`]
      ),
      confidence: 0.9,
    };
  }

  // 11. Semantic Router fallback before pure Q&A
  const topSemantic = ctx.semanticCandidates?.[0];
  if (topSemantic && topSemantic.score >= 0.58 && primary && domain === 'pdf') {
    if (topSemantic.id === 'redact') {
      return {
        kind: 'pdf_quick_action',
        action: 'hide-info',
        targetFile: primary.file,
        needsOcrFirst,
        requiresHandshake: false,
        trace: buildTrace(normalized, primary, [`Semantic match: Hide Personal Info (${Math.round(topSemantic.score * 100)}%)`]),
        confidence: topSemantic.score,
      };
    }
    if (topSemantic.id === 'compress') {
      return {
        kind: 'pdf_recipe',
        targetFile: primary.file,
        steps: planRecipeFromPrompt('compress balanced', { scannedPagesCount: scannedPages }),
        requiresHandshake: false,
        trace: buildTrace(normalized, primary, [`Semantic match: Compress PDF (${Math.round(topSemantic.score * 100)}%)`]),
        confidence: topSemantic.score,
      };
    }
  }

  // 12. Document Grounded Q&A or Local/Cloud AI Chat
  return {
    kind: 'qa_or_chat',
    question: normalized.cleaned,
    targetFile: primary?.file,
    trace: buildTrace(
      normalized,
      primary,
      primary ? ['Searching document passages & citations'] : ['Answering conversationally']
    ),
    confidence: primary ? 0.85 : 0.72,
  };
}
