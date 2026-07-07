# PKM-Shop clone runbook

Goal: stand up **PKM-Shop** as a full copy of MiraCare — an identical Supabase
backend plus a new GitHub repository whose code matches this one — running on its
own project so the two never share data.

> **Why you run this, not the assistant.** The source Supabase project
> `xwixdxmemwcuoamcloty` lives in a Supabase account that this workspace's
> connection cannot read (`get_project` returns *"You do not have permission"*).
> A faithful clone needs the source database connection string and its
> `service_role` key — credentials only the project owner holds. So the steps
> below are packaged as scripts **you** run with your own credentials. Nothing
> here is destructive to the source; it only reads from it.

## What "everything identical" actually contains

A Supabase project is more than its Postgres rows. Each layer needs its own copy
mechanism:

| Layer | Copied by | Notes |
|---|---|---|
| Roles, schema, RLS, functions, triggers, sequences | `scripts/clone-supabase-project.sh` | via `supabase db dump` → `psql` |
| Table data, incl. `auth.users`, `storage.buckets` rows | same script (`--data-only`) | password hashes carry over |
| Extensions (`pgcrypto`, `vector`) | included in the schema dump | |
| Storage **files** (bucket objects) | `scripts/clone-supabase-storage.mjs` | file bytes are **not** in a DB dump |
| Edge functions (17) | same script, or `deploy-v2-functions.ps1` | deployed from this repo |
| Function **secrets** (OpenAI/Stripe/LINE/prompt id) | manual — Step E | never dumped; you re-set them |
| Auth + project settings (redirect URLs, providers, SMTP, rate limits) | manual — Step F | platform config, not Postgres |

## Cross-account clone (source and target owned by different Supabase accounts)

The source `mira-health` lives in the `mediaforge2026` account; the target project
will live in a **different user's** account. Supabase has no "clone project to
another organization" button — and this toolkit does not need one, because every
step is driven by **per-project credentials**, not by account login:

- The database dump connects with `SOURCE_DB_URL` (a connection string that embeds
  its own password) and needs **no** Supabase access token, so it works against
  `mira-health` regardless of which account owns it.
- The restore and storage upload use the **target** project's `TARGET_DB_URL` and
  `TARGET_SERVICE_ROLE_KEY`.
- The edge-function deploy is the only step that reads `SUPABASE_ACCESS_TOKEN`, and
  that token must belong to the **target** account.

Two ways to bridge the account boundary:

- **Option A — get invited into the target org (simplest, least credential sharing).**
  The other user invites `mediaforge2026` into their Supabase organization
  (Organization → Team → Invite member; Developer/Admin/Owner). You then create the
  new project there and run the whole clone yourself — you already hold the source
  credentials, and your own access token now reaches the target, so no source
  `service_role` ever leaves your hands.
- **Option B — exchange credentials.** The other user creates the empty target
  project and gives you its `TARGET_DB_URL`, `TARGET_SERVICE_ROLE_KEY`, `TARGET_REF`,
  and a target access token; you supply the source `SOURCE_DB_URL` /
  `SOURCE_SERVICE_ROLE_KEY`. Fill both into `.env.clone` and run the scripts. If you
  would rather not share the source `service_role`, run only the dump + storage
  **download** half yourself, then hand the dump files and downloaded objects to the
  target operator to restore/upload.

Cross-account caveats:

- **Secrets are not copied.** In Step E set the target's own `OPENAI_API_KEY`, Stripe,
  and LINE secrets — either the same values (if the new owner should reuse them) or
  the new owner's own keys.
- **Auth users carry over, sessions do not.** Password hashes come across in the data
  dump so users can sign in again, but the target project signs JWTs with a different
  secret, so existing tokens/sessions are invalidated — expected.
- **The two projects are fully independent afterwards** — separate URLs, keys,
  billing, and data. Changes in one never touch the other.

## Prerequisites

- **Supabase CLI** — `npm i -g supabase` or use `npx --yes supabase`.
- **PostgreSQL client** (`psql`, `pg_dump`) — e.g. `apt-get install postgresql-client` / `brew install libpq`.
- **Node 18+** (this repo already uses it) for the storage helper.
- A **Supabase access token for the _target_ account** —
  <https://supabase.com/dashboard/account/tokens>. Used only to deploy edge
  functions into the target; the source dump needs only its connection string.
- For each project you need the **direct DB connection URI** (port 5432, not the
  pooler) from *Project Settings → Database → Connection string → URI*, and the
  **`service_role` key** from *Project Settings → API*.

Create a local `.env.clone` (git-ignored — do **not** commit it):

```bash
# Source (the project you are cloning FROM)
export SOURCE_DB_URL="postgresql://postgres:PASS@db.xwixdxmemwcuoamcloty.supabase.co:5432/postgres"
export SOURCE_URL="https://xwixdxmemwcuoamcloty.supabase.co"
export SOURCE_SERVICE_ROLE_KEY="…source service_role…"

# Target (the NEW empty PKM-Shop project — filled in after Step A)
export TARGET_DB_URL="postgresql://postgres:PASS@db.<new-ref>.supabase.co:5432/postgres"
export TARGET_URL="https://<new-ref>.supabase.co"
export TARGET_SERVICE_ROLE_KEY="…target service_role…"
export TARGET_REF="<new-ref>"

export SUPABASE_ACCESS_TOKEN="…account token…"
```

Then `source .env.clone` before running the scripts.

## Step A — Create the new Supabase project

Create it in the **target user's account/organization** (see *Cross-account clone*
above for how to bridge the boundary). Dashboard → *New project*, or CLI run with
the **target** account's `SUPABASE_ACCESS_TOKEN`:

```bash
supabase projects create "PKM-Shop" \
  --org-id <your-org-id> \
  --db-password "<strong-db-password>" \
  --region <same-region-as-source>
```

Copy the new project's ref, DB URI, and `service_role` key into `.env.clone`
(`TARGET_*`). Leave the project empty — the next step populates it.

## Step B — Clone the database (schema + roles + data)

```bash
source .env.clone
bash scripts/clone-supabase-project.sh          # add --no-functions to skip Step D here
```

The script dumps roles → schema → data from the source and restores them into the
target in a single transaction. It follows Supabase's official project-to-project
migration flow. Re-runnable against a fresh target; if a restore half-completes,
reset the target DB and re-run.

## Step C — Copy storage objects

The DB dump recreated the buckets and object rows, but not the files. Copy the
bytes:

```bash
source .env.clone
node scripts/clone-supabase-storage.mjs
```

This walks `lab-reports`, `line-assets`, `wearable-imports`,
`hospital-product-images`, and `payment-slips`, recreates any missing bucket, and
re-uploads every object with `upsert`.

## Step D — Deploy edge functions

`clone-supabase-project.sh` already deploys the 17 canonical functions (unless you
passed `--no-functions`). To do it on its own later, on Windows use the existing
helper:

```powershell
.\scripts\deploy-v2-functions.ps1   # reads SUPABASE_ACCESS_TOKEN + EXPO_PUBLIC_SUPABASE_URL
```

`line-webhook` and `stripe-webhook` are deployed with `--no-verify-jwt` because
they receive external callbacks. Two functions in the tree — `openai-transcribe`
and `rag-embed` — are outside the canonical deploy list; run
`supabase functions list --project-ref <source-ref>` against the source and deploy
either one to the target only if the source has it live.

## Step E — Re-set function secrets

Secrets are never dumped. Set them on the target (values come from the source
dashboard → *Edge Functions → Secrets*, or your own vault):

```bash
supabase secrets set --project-ref "$TARGET_REF" \
  OPENAI_API_KEY=… \
  MIRACARE_PROMPT_ID=pmpt_6a29c7e353b88196a6e648b24c54849e0f6204e24d65c021 \
  FACT_MODEL=gpt-5-mini \
  APP_BASE_URL=https://<pkm-shop-app> \
  STRIPE_SECRET_KEY=… \
  STRIPE_WEBHOOK_SECRET=… \
  MIRA_PUBLIC_APP_URL=https://<pkm-shop-app> \
  DEFAULT_USER_NICKNAME=ลูกค้า
```

Add any LINE per-tenant secrets your source uses
(`LINE_CHANNEL_SECRET__<tenant_slug>`, `LINE_CHANNEL_TOKEN__<tenant_slug>` — see
`docs/line-setup.md`). Point the Stripe webhook at
`https://<new-ref>.supabase.co/functions/v1/stripe-webhook`.

## Step F — Reapply auth & project settings

These are platform config, not Postgres, so copy them from the source dashboard by
hand: Auth → URL configuration (Site URL + redirect allow-list), Auth providers,
email/SMTP templates, JWT expiry, rate limits, and any custom API settings. If the
source pins them in a `supabase/config.toml`, `supabase config push` instead.

## Step G — Create the PKM-Shop GitHub repo with this code

The app code is identical; only the backend wiring differs. From a clean checkout
of this repository:

```bash
# 1. Create the empty repo (gh CLI shown; or create it in the GitHub UI)
gh repo create <owner>/PKM-Shop --private --disable-wiki

# 2. Push this codebase to it under a fresh history root or as a mirror of main
git remote add pkm https://github.com/<owner>/PKM-Shop.git
git push pkm HEAD:main

# 3. In the PKM-Shop clone, point the app at the new backend
#    .env:
#      EXPO_PUBLIC_SUPABASE_URL=https://<new-ref>.supabase.co
#      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<target-key>
```

Nothing in the app source hardcodes the project ref — it is read from
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — so no code
edits are required to retarget PKM-Shop at its own Supabase project.

## Verification

1. `supabase db dump --db-url "$TARGET_DB_URL" --schema-only | diff -` against the
   source schema dump — expect no differences.
2. Row-count spot check on key tables (`profiles`, `products`, `orders`,
   `chat_messages`) — source vs target.
3. In the PKM-Shop app with the new `.env`, sign in and confirm a chat turn and a
   catalog load succeed (exercises `chat-orchestrator` + RLS + secrets).
4. Open a private-bucket asset (e.g. a lab report) via a signed URL to confirm
   Step C copied the files.
5. Run `npm run v2:verify` in the PKM-Shop repo — the same gates that guard this
   one should stay green.
