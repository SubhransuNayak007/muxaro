import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeUserUtterance } from '../intent-normalizer.ts';
import { resolveContextualTargets } from '../workspace-memory.ts';
import { resolveAgentIntent } from '../intent-router.ts';

function fakeFile(name, type, sizeBytes = 1024 * 1024) {
  const f = new File([new Uint8Array(Math.min(sizeBytes, 64))], name, { type });
  Object.defineProperty(f, 'size', { value: sizeBytes });
  return f;
}

test('normalizes spoken self-corrections and number words cleanly', () => {
  const n = normalizeUserUtterance('hey muxaro compress it to twenty five mb no wait make it ten mb please');
  assert.equal(n.extractedSizeMb, 10);
  assert.ok(n.corrections.length >= 1);
  assert.match(n.corrections[0].to, /10 mb/i);
});

test('normalizes time reversals ("trim 0:10 to 0:40 actually 0:55")', () => {
  const n = normalizeUserUtterance('trim from 0:10 to 0:40 actually make that 0:55');
  assert.deepEqual(n.extractedTimesSec, ['0:10', '0:55']);
  assert.equal(n.corrections[0].from, '0:40');
});

test('normalizes Hinglish requests accurately without losing context', () => {
  const n = normalizeUserUtterance('is video ki audio nikal do and whatsapp ke liye chhota karo');
  assert.equal(n.hinglishDetected, true);
  assert.equal(n.extractedSizeMb, 16);
  assert.match(n.normalizedEnglish, /extract audio mp3/i);
  assert.match(n.normalizedEnglish, /whatsapp 16 mb/i);
});

test('handles full scratch-that dictations', () => {
  const n = normalizeUserUtterance('rotate ninety degrees scratch that hide my phone number and aadhaar');
  assert.ok(n.corrections.some((c) => /rotate/i.test(c.from)));
  assert.match(n.normalizedEnglish, /hide personal info|redact/i);
});

test('resolves multi-file ordinals and named file coreferences', () => {
  const pdf1 = fakeFile('Contract-2025.pdf', 'application/pdf');
  const pdf2 = fakeFile('Tax-Receipt.pdf', 'application/pdf');
  const vid1 = fakeFile('Holiday-Clip.mp4', 'video/mp4');
  const memory = {
    entities: [
      { id: 'e1', file: pdf1, domain: 'pdf', attachedAt: 1 },
      { id: 'e2', file: pdf2, domain: 'pdf', attachedAt: 2 },
      { id: 'e3', file: vid1, domain: 'video', attachedAt: 3 },
    ],
  };

  const r1 = resolveContextualTargets(normalizeUserUtterance('summarize the second pdf'), memory);
  assert.equal(r1.primary?.id, 'e2');

  const r2 = resolveContextualTargets(normalizeUserUtterance('compress the video for discord'), memory);
  assert.equal(r2.primary?.id, 'e3');

  const r3 = resolveContextualTargets(normalizeUserUtterance('hide personal info in Tax-Receipt'), memory);
  assert.equal(r3.primary?.id, 'e2');
});

test('asks clarification instead of guessing when multiple distinct domains exist without an active file', () => {
  const pdf = fakeFile('Notes.pdf', 'application/pdf');
  const vid = fakeFile('Clip.mp4', 'video/mp4');
  const res = resolveAgentIntent({
    rawText: 'compress this now',
    composerAttachments: [],
    memory: {
      entities: [
        { id: '1', file: pdf, domain: 'pdf', attachedAt: 1 },
        { id: '2', file: vid, domain: 'video', attachedAt: 2 },
      ],
    },
  });
  assert.equal(res.kind, 'clarification');
  assert.equal(res.options.length, 2);
});

test('offers smart preset chips when shrinking video without target MB', () => {
  const vid = fakeFile('BigMovie.mp4', 'video/mp4', 85 * 1024 * 1024);
  const res = resolveAgentIntent({
    rawText: 'my email bounced because this video is huge, shrink it',
    composerAttachments: [vid],
    memory: {
      entities: [{ id: 'v1', file: vid, domain: 'video', attachedAt: 1 }],
      activeEntityId: 'v1',
    },
  });
  assert.equal(res.kind, 'clarification');
  assert.ok(res.options.some((o) => o.label.includes('WhatsApp')));
  assert.ok(res.options.some((o) => o.label.includes('Discord')));
});

test('plans compound multi-step media + cross-domain PDF notes pipeline', () => {
  const lecture = fakeFile('Lecture-01.mp4', 'video/mp4');
  const res = resolveAgentIntent({
    rawText: 'trim 0:10 to 0:45 reframe for reels and extract audio into study notes pdf',
    composerAttachments: [lecture],
    memory: {
      entities: [{ id: 'v1', file: lecture, domain: 'video', attachedAt: 1 }],
      activeEntityId: 'v1',
    },
  });
  assert.equal(res.kind, 'media_pipeline');
  assert.deepEqual(
    res.steps.map((s) => s.tool),
    ['trim', 'aspect', 'extract_audio', 'transcribe_to_notes_pdf']
  );
});

test('supports iterative follow-up tweaks on previous compression ("make it smaller")', () => {
  const vid = fakeFile('Demo.mp4', 'video/mp4');
  const res = resolveAgentIntent({
    rawText: 'make it smaller',
    composerAttachments: [],
    memory: {
      entities: [{ id: 'v1', file: vid, domain: 'video', attachedAt: 1 }],
      activeEntityId: 'v1',
      lastAction: {
        suite: 'video',
        toolId: 'compress',
        params: { targetSizeMb: 16 },
        executedAt: Date.now(),
      },
    },
  });
  assert.equal(res.kind, 'media_pipeline');
  assert.equal(res.steps[0].targetSizeMb, 10);
});

test('auto-injects Searchable OCR when user requests redaction on a scanned PDF', () => {
  const scanPdf = fakeFile('Scanned-ID.pdf', 'application/pdf');
  const res = resolveAgentIntent({
    rawText: 'remove blank pages, redact my phone number, and compress',
    composerAttachments: [scanPdf],
    memory: {
      entities: [
        {
          id: 'p1',
          file: scanPdf,
          domain: 'pdf',
          attachedAt: 1,
          pdfMeta: { pageCount: 5, scannedPagesCount: 5 },
        },
      ],
      activeEntityId: 'p1',
    },
  });
  assert.equal(res.kind, 'pdf_recipe');
  assert.equal(res.steps[0].toolId, 'ocr_pdf');
  assert.ok(res.steps.some((s) => s.toolId === 'smart_redact_pii'));
});

test('requires voice confirmation handshake on voice-triggered destructive PDF recipes', () => {
  const pdf = fakeFile('Lease.pdf', 'application/pdf');
  const res = resolveAgentIntent({
    rawText: 'lock this pdf with a password and remove blank pages',
    composerAttachments: [pdf],
    fromVoice: true,
    memory: {
      entities: [{ id: 'p1', file: pdf, domain: 'pdf', attachedAt: 1 }],
      activeEntityId: 'p1',
    },
  });
  assert.equal(res.kind, 'pdf_recipe');
  assert.equal(res.requiresHandshake, true);
});
