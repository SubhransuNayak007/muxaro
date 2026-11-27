import type { NormalizedUtterance } from './intent-normalizer.ts';

export type WorkspaceFileDomain = 'pdf' | 'video' | 'audio' | 'image';

export interface WorkspaceEntity {
  id: string;
  file: File;
  domain: WorkspaceFileDomain;
  attachedAt: number;
  isOutput?: boolean;
  localPath?: string;
  mediaMeta?: {
    width?: number;
    height?: number;
    isHdr?: boolean;
    durationSec?: number;
  };
  pdfMeta?: {
    pageCount: number;
    scannedPagesCount: number;
  };
  lastActionSummary?: string;
}

export interface LastExecutedAction {
  suite: 'pdf' | 'video' | 'audio' | 'image' | 'chat';
  toolId: string;
  params: Record<string, string | number | boolean>;
  targetFileName?: string;
  outputFileName?: string;
  executedAt: number;
}

export interface WorkspaceMemorySnapshot {
  entities: WorkspaceEntity[];
  activeEntityId?: string;
  lastOutputEntityId?: string;
  lastAction?: LastExecutedAction;
}

export interface ResolvedEntityTarget {
  entities: WorkspaceEntity[];
  primary?: WorkspaceEntity;
  resolutionNote?: string;
  ambiguousEntities?: WorkspaceEntity[];
}

export function inferWorkspaceDomain(file: File): WorkspaceFileDomain {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp|svg|heic|tif|tiff)$/i.test(name)) {
    return 'image';
  }
  if (file.type.startsWith('audio/') || /\.(mp3|wav|flac|aac|m4a|opus|ogg)$/i.test(name)) {
    return 'audio';
  }
  return 'video';
}

export function resolveContextualTargets(
  utterance: NormalizedUtterance,
  memory: WorkspaceMemorySnapshot
): ResolvedEntityTarget {
  const { entities, activeEntityId, lastOutputEntityId } = memory;
  if (entities.length === 0) {
    return { entities: [], primary: undefined };
  }

  const text = utterance.normalizedEnglish.toLowerCase();

  // 1. Direct filename mention matches (strip extension for relaxed matching)
  const namedMatch = entities.filter((e) => {
    const stem = e.file.name.replace(/\.[^.]+$/, '').toLowerCase();
    return stem.length >= 4 && text.includes(stem);
  });
  if (namedMatch.length > 0) {
    return {
      entities: namedMatch,
      primary: namedMatch[0],
      resolutionNote: `Matched file "${namedMatch[0].file.name}"`,
    };
  }

  // 2. Domain-specific nouns ("the pdf", "that video", "these images")
  const domainHint: WorkspaceFileDomain | undefined = /\b(pdfs?|documents?|contract|invoice|report|scan)\b/i.test(text)
    ? 'pdf'
    : /\b(videos?|clips?|footage|reels?|mp4|mkv|mov)\b/i.test(text)
      ? 'video'
      : /\b(audios?|songs?|tracks?|voice|mp3|wav)\b/i.test(text)
        ? 'audio'
        : /\b(images?|photos?|pictures?|screenshots?|scans?)\b/i.test(text)
          ? 'image'
          : undefined;

  const domainPool = domainHint ? entities.filter((e) => e.domain === domainHint) : entities;
  const pool = domainPool.length > 0 ? domainPool : entities;

  // 3. Explicit ordinals & last output
  if (utterance.ordinalRef === 'previous_output' && lastOutputEntityId) {
    const out = entities.find((e) => e.id === lastOutputEntityId);
    if (out) {
      return {
        entities: [out],
        primary: out,
        resolutionNote: `Referenced previous result "${out.file.name}"`,
      };
    }
  }

  if (utterance.ordinalRef === 'first' && pool[0]) {
    return {
      entities: [pool[0]],
      primary: pool[0],
      resolutionNote: `Selected first file "${pool[0].file.name}"`,
    };
  }

  if (utterance.ordinalRef === 'second' && pool[1]) {
    return {
      entities: [pool[1]],
      primary: pool[1],
      resolutionNote: `Selected second file "${pool[1].file.name}"`,
    };
  }

  if (utterance.ordinalRef === 'third' && pool[2]) {
    return {
      entities: [pool[2]],
      primary: pool[2],
      resolutionNote: `Selected third file "${pool[2].file.name}"`,
    };
  }

  if (utterance.ordinalRef === 'last' && pool.length > 0) {
    const last = pool[pool.length - 1];
    return {
      entities: [last],
      primary: last,
      resolutionNote: `Selected latest file "${last.file.name}"`,
    };
  }

  if (utterance.ordinalRef === 'all') {
    return {
      entities: pool,
      primary: pool[0],
      resolutionNote: `Selected all ${pool.length} matching file(s)`,
    };
  }

  // 4. Ambiguity detection when multiple unrelated active files sit in different domains & no hint exists
  const distinctDomains = new Set(entities.filter((e) => !e.isOutput).map((e) => e.domain));
  if (
    entities.length >= 2 &&
    !activeEntityId &&
    !domainHint &&
    distinctDomains.size > 1 &&
    /\b(compress|shrink|redact|hide|summarize|trim|convert)\b/i.test(text)
  ) {
    return {
      entities,
      primary: entities[0],
      ambiguousEntities: entities.slice(0, 4),
    };
  }

  const active =
    (activeEntityId ? pool.find((e) => e.id === activeEntityId) : undefined) ||
    pool[pool.length - 1];

  return {
    entities: pool,
    primary: active,
  };
}

export function buildNextSmallerTargetMb(currentMb?: number): number {
  if (!currentMb || currentMb > 25) return 25;
  if (currentMb > 16) return 16;
  if (currentMb > 10) return 10;
  if (currentMb > 5) return 5;
  return 2;
}
