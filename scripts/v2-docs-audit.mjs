import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const docs = [
  'README.md',
  'docs/changes/phase-1.md',
  'docs/changes/phase-2.md',
  'docs/changes/phase-3.md',
  'docs/changes/phase-5.md',
  'docs/changes/phase-6.md',
  'docs/line-setup.md',
  'docs/miracare-v2-product-plan.md',
  'docs/v2-audit-report-2026-06-11.md',
  'docs/v2-gap-analysis.md',
  'docs/v2-local-readiness.md',
  'docs/v2-open-questions.md',
];

const stalePatterns = [
  [/16 edge\/shared\/storage\/template files scanned/i, 'edge-security audit now scans 17 files'],
  [/15 edge\/shared\/storage\/template files scanned/i, 'edge-security audit now scans 17 files'],
  [/14 edge\/shared\/storage\/template files scanned/i, 'edge-security audit now scans 17 files'],
  [/13 edge\/shared\/template files scanned/i, 'edge-security audit now scans 17 files'],
  [/13 edge\/shared files scanned/i, 'edge-security audit now scans 17 files'],
  [/13 files scanned/i, 'edge-security audit now scans 17 files'],
  [/12 edge\/shared files scanned/i, 'edge-security audit now scans 17 files'],
  [/12 files scanned/i, 'edge-security audit now scans 17 files'],
  [/29 production files scanned/i, 'client audit now scans 30 production files'],
  [/28 production files scanned/i, 'client audit now scans 30 production files'],
  [/26 production files scanned/i, 'client audit now scans 30 production files'],
  [/64 client files secret-scanned/i, 'client audit now secret-scans 65 client files'],
  [/7 v2 edge entrypoints/i, 'Deno check now covers the active v2 edge entrypoints'],
  [/19 unresolved-contract topics/i, 'open-questions audit now tracks 2 unresolved-contract topics'],
  [/17 decision blockers/i, 'local-readiness audit now tracks 1 decision blocker'],
  [/32 migrations checked/i, 'schema audit now checks 33 migrations'],
  [/32 numbered migrations/i, 'schema audit now checks 33 migrations'],
  [/31 numbered migrations/i, 'schema audit now checks 33 migrations'],
  [/30 indexes/i, 'schema audit now checks 31 indexes'],
  [/11 docs checked/i, 'docs audit now checks 12 docs including LINE setup'],
  [/4 external gates/i, 'local-readiness audit now checks 5 external gates'],
  [/four external gates/i, 'external preflight now reports five external gates'],
  [/11 health\/lab/i, 'health/lab/wearable runtime is no longer active scope'],
  [/83 shared tests/i, 'shared Deno suite count should not be hard-coded'],
  [/passed with 83/i, 'shared Deno suite count should not be hard-coded'],
  [/79 shared tests/i, 'shared Deno suite count should not be hard-coded'],
  [/75 shared tests/i, 'shared Deno suite count should not be hard-coded'],
  [/68 shared tests/i, 'shared Deno suite count should not be hard-coded'],
  [/60 shared tests/i, 'shared Deno suite count should not be hard-coded'],
  [/62 shared tests/i, 'shared Deno suite count should not be hard-coded'],
  [/passed with 79/i, 'shared Deno suite count should not be hard-coded'],
  [/passed with 75/i, 'shared Deno suite count should not be hard-coded'],
  [/passed with 68/i, 'shared Deno suite count should not be hard-coded'],
  [/passed with 60/i, 'shared Deno suite count should not be hard-coded'],
  [/passed with 62/i, 'shared Deno suite count should not be hard-coded'],
  [/140 files scanned/i, 'order status audit count drifted after new audit scripts'],
  [/141 files scanned/i, 'order status audit count drifted after new audit scripts'],
  [/142 files scanned/i, 'order status audit count drifted after new audit scripts'],
  [/143 files scanned/i, 'order status audit count drifted after new audit scripts'],
  [/ZIP parsing is not enabled yet/i, 'Apple Health zip export.xml streaming is implemented'],
];

const requiredSnippets = [
  ['README.md', 'npm run v2:verify'],
  ['README.md', 'npm run v2:external-preflight'],
  ['README.md', 'v2:local-readiness-audit'],
  ['README.md', 'v2:open-questions-audit'],
  ['README.md', 'npm run v2:e2e-commerce'],
  ['docs/v2-local-readiness.md', '`npm run v2:local-readiness-audit`'],
  ['docs/v2-local-readiness.md', 'live commerce E2E setup'],
  ['docs/v2-gap-analysis.md', '`npm run v2:e2e-commerce`'],
  ['docs/v2-gap-analysis.md', '`npm run v2:docs-audit`: passing'],
  ['docs/v2-gap-analysis.md', '`npm run v2:open-questions-audit`: passing'],
  ['docs/v2-gap-analysis.md', '`npm run v2:local-readiness-audit`: passing'],
  ['docs/v2-audit-report-2026-06-11.md', '`npm run v2:docs-audit`'],
  ['docs/v2-audit-report-2026-06-11.md', '`npm run v2:local-readiness-audit`'],
  ['docs/changes/phase-6.md', 'shared Deno tests'],
  ['docs/line-setup.md', 'LINE_CHANNEL_SECRET__<tenant_slug>'],
  ['docs/line-setup.md', 'LINE_CHANNEL_TOKEN__<tenant_slug>'],
  ['docs/line-setup.md', '/functions/v1/line-webhook?tenant=<slug>'],
  ['docs/line-setup.md', '## Manual Sandbox Checklist'],
];

const violations = [];
const sources = new Map(
  await Promise.all(docs.map(async (relativePath) => [relativePath, await read(relativePath)])),
);

for (const [relativePath, source] of sources) {
  for (const [pattern, detail] of stalePatterns) {
    if (pattern.test(source)) {
      violations.push(`${relativePath}: stale verification evidence matched ${pattern}; ${detail}`);
    }
  }
}

for (const [relativePath, snippet] of requiredSnippets) {
  const source = sources.get(relativePath) ?? '';

  if (!source.includes(snippet)) {
    violations.push(`${relativePath}: missing required verification evidence "${snippet}"`);
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log(`v2-docs-audit: PASS (${docs.length} docs checked)`);

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
}
