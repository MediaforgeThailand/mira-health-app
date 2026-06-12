import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, 'supabase/migrations');
const pdpaHelperPath = path.join(repoRoot, 'supabase/functions/_shared/pdpa.ts');
const violations = [];

function tableBlocks(source) {
  return [...source.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\);\s*/gi)].map((match) => ({
    body: match[2],
    table: match[1],
  }));
}

function addedCustomerColumns(source) {
  return [...source.matchAll(/alter\s+table\s+public\.([a-z0-9_]+)\s+add\s+column\s+if\s+not\s+exists\s+customer_id\b/gi)].map((match) => match[1]);
}

function extractConstArray(source, name) {
  const match = source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const`));

  if (!match) {
    violations.push(`supabase/functions/_shared/pdpa.ts: missing ${name}`);
    return [];
  }

  return [...match[1].matchAll(/'([a-z0-9_]+)'/g)].map((entry) => entry[1]);
}

const migrationFiles = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
const customerTables = new Set();

for (const file of migrationFiles) {
  const source = await fs.readFile(path.join(migrationsDir, file), 'utf8');

  for (const block of tableBlocks(source)) {
    if (/\bcustomer_id\b/i.test(block.body)) {
      customerTables.add(block.table);
    }
  }

  for (const table of addedCustomerColumns(source)) {
    customerTables.add(table);
  }
}

const pdpaSource = await fs.readFile(pdpaHelperPath, 'utf8');
const deleteTables = extractConstArray(pdpaSource, 'PDPA_CUSTOMER_DELETE_TABLES');
const anonymizeTables = extractConstArray(pdpaSource, 'PDPA_CUSTOMER_ANONYMIZE_TABLES');
const tombstoneTables = extractConstArray(pdpaSource, 'PDPA_CUSTOMER_TOMBSTONE_TABLES');
const coveredTables = new Set([...deleteTables, ...anonymizeTables, ...tombstoneTables]);

for (const table of [...customerTables].sort()) {
  if (!coveredTables.has(table)) {
    violations.push(`${table}: customer_id table is not covered by PDPA delete/anonymize/tombstone lists`);
  }
}

if (!pdpaSource.includes('deleteLegacyUserRows')) {
  violations.push('supabase/functions/_shared/pdpa.ts: missing legacy user_id cleanup note/path');
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log(`pdpa-coverage-audit: PASS (${customerTables.size} customer_id tables covered)`);
