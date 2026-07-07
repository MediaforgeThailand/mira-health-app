// clone-supabase-storage.mjs — Copy Storage objects (the actual files) from a
// source Supabase project to a target one.
//
// A Postgres dump reproduces the `storage.buckets` and `storage.objects` ROWS,
// but the file bytes live in object storage (S3), not Postgres — so they must be
// streamed across separately. This walks every bucket on the source, recreates
// missing buckets on the target, and re-uploads each object with upsert.
//
// Buckets cloned by MiraCare's schema: lab-reports, line-assets, wearable-imports,
// hospital-product-images, payment-slips. This script discovers them dynamically,
// so it stays correct if buckets change.
//
// Required env (service_role keys — Dashboard -> Project Settings -> API):
//   SOURCE_URL                https://<source-ref>.supabase.co
//   SOURCE_SERVICE_ROLE_KEY   service_role secret of the source project
//   TARGET_URL                https://<target-ref>.supabase.co
//   TARGET_SERVICE_ROLE_KEY   service_role secret of the target project
//
// Run:  node scripts/clone-supabase-storage.mjs
//
// service_role bypasses RLS by design; keep these keys server-side only.
import { createClient } from '@supabase/supabase-js';

const {
  SOURCE_URL,
  SOURCE_SERVICE_ROLE_KEY,
  TARGET_URL,
  TARGET_SERVICE_ROLE_KEY,
} = process.env;

for (const [name, value] of Object.entries({
  SOURCE_URL,
  SOURCE_SERVICE_ROLE_KEY,
  TARGET_URL,
  TARGET_SERVICE_ROLE_KEY,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };
const source = createClient(SOURCE_URL, SOURCE_SERVICE_ROLE_KEY, clientOpts);
const target = createClient(TARGET_URL, TARGET_SERVICE_ROLE_KEY, clientOpts);

const PAGE = 100;

// storage.from().list() is prefix-scoped and non-recursive; entries without an
// `id` are folders, so recurse into them to enumerate every object path.
async function listAll(client, bucket, prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null || entry.id === undefined) {
        files.push(...(await listAll(client, bucket, path))); // folder
      } else {
        files.push({ path, contentType: entry.metadata?.mimetype });
      }
    }
    if (data.length < PAGE) break;
  }
  return files;
}

async function ensureBucket(bucket) {
  const { data: existing } = await target.storage.getBucket(bucket.id);
  if (existing) return;
  const { error } = await target.storage.createBucket(bucket.id, {
    public: bucket.public,
    fileSizeLimit: bucket.file_size_limit ?? undefined,
    allowedMimeTypes: bucket.allowed_mime_types ?? undefined,
  });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`createBucket ${bucket.id}: ${error.message}`);
  }
}

async function main() {
  const { data: buckets, error } = await source.storage.listBuckets();
  if (error) throw new Error(`listBuckets: ${error.message}`);
  if (!buckets.length) {
    console.log('No storage buckets on source. Nothing to copy.');
    return;
  }

  let copied = 0;
  let failed = 0;
  for (const bucket of buckets) {
    console.log(`\n# bucket ${bucket.id} (public=${bucket.public})`);
    await ensureBucket(bucket);

    const objects = await listAll(source, bucket.id);
    console.log(`  ${objects.length} object(s)`);

    for (const obj of objects) {
      const { data: blob, error: dErr } = await source.storage.from(bucket.id).download(obj.path);
      if (dErr) {
        console.error(`  ! download ${obj.path}: ${dErr.message}`);
        failed++;
        continue;
      }
      const { error: uErr } = await target.storage
        .from(bucket.id)
        .upload(obj.path, blob, { upsert: true, contentType: obj.contentType || blob.type || undefined });
      if (uErr) {
        console.error(`  ! upload ${obj.path}: ${uErr.message}`);
        failed++;
        continue;
      }
      copied++;
    }
  }

  console.log(`\nDone. Copied ${copied} object(s), ${failed} failure(s) across ${buckets.length} bucket(s).`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
