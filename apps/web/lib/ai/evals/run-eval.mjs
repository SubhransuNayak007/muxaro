import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

import { normalizeUserUtterance } from '../intent-normalizer.ts';
import { resolveContextualTargets } from '../workspace-memory.ts';
import { sanitizeDocumentTextForPrompt } from '../prompt-guard.ts';
import { isPrivateOrReservedIp } from '../server/ssrf-guard.ts';
import { computeReciprocalRankFusion } from '../v3/rrf.ts';
import { selectActiveToolDefinitions } from '../v3/tool-dispatcher.ts';

const suitePath = path.resolve(import.meta.dirname, 'frozen-suite.json');
const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));

function fakeFile(name) {
  return new File([new Uint8Array(64)], name, {
    type: name.endsWith('.pdf') ? 'application/pdf' : 'video/mp4',
  });
}

let passed = 0;
const failures = [];

for (const c of suite.cases) {
  try {
    if (c.category === 'normalization') {
      const n = normalizeUserUtterance(c.input);
      if (c.expectSizeMb !== undefined) assert.equal(n.extractedSizeMb, c.expectSizeMb);
      if (c.expectHinglish !== undefined) assert.equal(n.hinglishDetected, c.expectHinglish);
      if (c.expectEnglishRegex) assert.match(n.normalizedEnglish, new RegExp(c.expectEnglishRegex, 'i'));
    } else if (c.category === 'routing') {
      const entities = c.files.map((fname, idx) => ({
        id: `e${idx + 1}`,
        file: fakeFile(fname),
        domain: fname.endsWith('.pdf') ? 'pdf' : 'video',
        attachedAt: idx + 1,
      }));
      const res = resolveContextualTargets(normalizeUserUtterance(c.input), { entities });
      assert.equal(res.primary?.file.name, c.expectTargetName);
    } else if (c.category === 'security') {
      const clean = sanitizeDocumentTextForPrompt(c.rawDocText);
      for (const bad of c.mustNotContainRaw) {
        assert.equal(clean.includes(bad), false, `Unsanitized token "${bad}" leaked`);
      }
    } else if (c.category === 'ssrf') {
      for (const ip of c.blockedIps) {
        assert.equal(isPrivateOrReservedIp(ip), true, `Expected IP blocked: ${ip}`);
      }
      for (const ip of c.allowedIps) {
        assert.equal(isPrivateOrReservedIp(ip), false, `Expected public IP allowed: ${ip}`);
      }
    } else if (c.category === 'rag') {
      const fused = computeReciprocalRankFusion([
        { weight: 1.0, items: c.bm25RankedIds.map((id) => ({ id })) },
        { weight: 1.0, items: c.denseRankedIds.map((id) => ({ id })) },
      ]);
      assert.equal(fused[0]?.item.id, c.expectTopId);
    } else if (c.category === 'context_engineering') {
      const res = selectActiveToolDefinitions({
        userGoal: c.userGoal,
        hasPdfAttached: true,
        hasMediaAttached: true,
        allowWebTools: true,
        hasConnectedMcp: true,
      });
      assert.ok(res.tools.length <= c.expectMaxTools, `Too many tools injected: ${res.tools.length}`);
    }
    passed += 1;
  } catch (err) {
    failures.push({ id: c.id, error: err instanceof Error ? err.message : String(err) });
  }
}

const total = suite.cases.length;
const scorePct = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;
console.log(
  JSON.stringify({
    suiteVersion: suite.version,
    passed,
    failed: failures.length,
    total,
    scorePct,
    failures,
  })
);

if (failures.length > 0) {
  process.exit(1);
}
