import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const deployScriptPath = 'scripts/deploy-v2-functions.ps1';
const removedScriptPath = 'scripts/deploy-mira-chat.ps1';
const expectedFunctions = [
  'chat-orchestrator',
  'fact-extractor',
  'admin-order-action',
  'referrer-order',
  'line-webhook',
  'stripe-checkout',
  'stripe-webhook',
  'lab-ingest',
  'lab-confirm',
  'wearable-ingest',
  'pdpa-export',
  'pdpa-delete',
];
const scanRoots = ['scripts', '.github', 'README.md', 'docs'];
const violations = [];

async function exists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function listFiles(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  const stat = await fs.stat(fullPath);

  if (stat.isFile()) {
    return [fullPath];
  }

  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => listFiles(path.join(relativePath, entry.name))));

  return nested.flat();
}

if (await exists(removedScriptPath)) {
  violations.push(`${removedScriptPath}: legacy deploy helper must be deleted`);
}

if (!(await exists(deployScriptPath))) {
  violations.push(`${deployScriptPath}: missing v2 deploy helper`);
} else {
  const source = await fs.readFile(path.join(repoRoot, deployScriptPath), 'utf8');
  const deployedFunctions = [...source.matchAll(/npx\s+supabase\s+functions\s+deploy\s+([a-z0-9-]+)/g)].map((match) => match[1]);

  if (deployedFunctions.join(',') !== expectedFunctions.join(',')) {
    violations.push(`${deployScriptPath}: expected deploy allow-list ${expectedFunctions.join(', ')}, got ${deployedFunctions.join(', ')}`);
  }

  if (!source.includes('line-webhook --project-ref $projectRef --no-verify-jwt')) {
    violations.push(`${deployScriptPath}: line-webhook must deploy with --no-verify-jwt for LINE callbacks`);
  }

  if (!source.includes('stripe-webhook --project-ref $projectRef --no-verify-jwt')) {
    violations.push(`${deployScriptPath}: stripe-webhook must deploy with --no-verify-jwt for Stripe callbacks`);
  }
}

const files = (await Promise.all(scanRoots.map((root) => listFiles(root)))).flat();
const forbiddenDeployPattern = /(?:npx\s+)?supabase\s+functions\s+deploy\s+(?:gemini-chat|mira-chat|\*|--all)\b/i;
const forbiddenHelperPattern = /deploy-mira-chat\.ps1/i;

for (const file of files) {
  const relativeFile = path.relative(repoRoot, file).replace(/\\/g, '/');

  if (
    relativeFile === 'scripts/v2-deploy-script-audit.mjs' ||
    relativeFile === 'docs/v2-fixes-and-unblock-plan.md' ||
    relativeFile === 'docs/changes/a5-ghost-deploy-cleanup.md'
  ) {
    continue;
  }

  const source = await fs.readFile(file, 'utf8');

  if (forbiddenDeployPattern.test(source)) {
    violations.push(`${relativeFile}: forbidden legacy or wildcard Supabase function deploy invocation`);
  }

  if (forbiddenHelperPattern.test(source)) {
    violations.push(`${relativeFile}: stale deploy-mira-chat helper reference`);
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log(`v2-deploy-script-audit: PASS (${expectedFunctions.length} v2 functions allow-listed, ${files.length} files scanned)`);
