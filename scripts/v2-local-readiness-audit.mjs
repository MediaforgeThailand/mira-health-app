import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const files = {
  auditReport: 'docs/v2-audit-report-2026-06-11.md',
  gapAnalysis: 'docs/v2-gap-analysis.md',
  localReadiness: 'docs/v2-local-readiness.md',
  openQuestions: 'docs/v2-open-questions.md',
};

const [auditReport, gapAnalysis, localReadiness, openQuestions] = await Promise.all(
  Object.values(files).map((relativePath) => read(relativePath)),
);

const violations = [];

const missingRows = [...gapAnalysis.matchAll(/^\|\s*([^|]+?)\s*\|\s*Missing\s*\|/gm)].map((match) => match[1].trim());

expect(
  'no unblocked missing rows',
  missingRows.length === 0,
  `${files.gapAnalysis} still has Missing rows that should either be implemented locally or moved to Blocked with ${files.openQuestions}: ${missingRows.join(', ')}`,
);

const requiredReadinessSnippets = [
  '# MiraCare v2 Local Readiness',
  '## Local Work Completed Without External Setup',
  '## No Unblocked Missing Rows',
  '## Still Blocked By Owner Decision',
  '## Still Blocked By External Setup',
  '`npm run v2:local-readiness-audit`',
  '`npm run v2:verify`',
  '`npm run v2:external-preflight`',
  'This file should not list secret values.',
];

for (const snippet of requiredReadinessSnippets) {
  expect(
    `local readiness snippet ${snippet}`,
    localReadiness.includes(snippet),
    `${files.localReadiness} must include "${snippet}"`,
  );
}

const decisionTopics = [];

for (const topic of decisionTopics) {
  expect(
    `decision blocker ${topic}`,
    localReadiness.toLowerCase().includes(topic.toLowerCase()),
    `${files.localReadiness} must keep owner decision blocker "${topic}" visible`,
  );
}

const externalGateNames = [
  'seed-demo service role setup',
  'seeded chat regression setup',
  'live RLS project setup',
  'live commerce E2E setup',
  'LINE sandbox setup',
];

for (const gate of externalGateNames) {
  expect(
    `external gate ${gate}`,
    localReadiness.includes(gate),
    `${files.localReadiness} must list external preflight gate "${gate}"`,
  );
}

expect(
  'open questions authority',
  localReadiness.includes('docs/v2-open-questions.md') && auditReport.includes('The authoritative blocker list is `docs/v2-open-questions.md`.'),
  'local readiness and audit report must point to the authoritative open-question list',
);

expect(
  'external preflight caveat',
  localReadiness.includes('does not prove seeded/live regressions passed') &&
    gapAnalysis.includes('reports five external gates waiting'),
  'local readiness must distinguish external readiness preflight from external proof',
);

expect(
  'open questions still cover blockers',
  decisionTopics.every((topic) => openQuestions.toLowerCase().includes(topic.toLowerCase())),
  `${files.openQuestions} must remain the source document for owner-decision blockers`,
);

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log(
  `v2-local-readiness-audit: PASS (${missingRows.length} Missing rows, ${decisionTopics.length} decision blocker${decisionTopics.length === 1 ? '' : 's'}, ${externalGateNames.length} external gates checked)`,
);

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
}

function expect(name, condition, detail) {
  if (!condition) {
    violations.push(`${name}: ${detail}`);
  }
}
