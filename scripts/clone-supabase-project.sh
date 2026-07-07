#!/usr/bin/env bash
#
# clone-supabase-project.sh — Clone one Supabase project into another so the
# target is a faithful copy of the source (schema + roles + data + edge
# functions). Storage objects, function secrets, and dashboard/auth settings are
# NOT covered here — see docs/pkm-shop-clone-runbook.md for the full checklist
# and the companion scripts/clone-supabase-storage.mjs helper.
#
# WHY a script instead of the dashboard: a Supabase project's Postgres state
# (public + auth + storage.buckets rows, RLS, functions, triggers, sequences)
# is only fully reproducible with pg_dump/pg_restore. This wraps the official
# Supabase "migrate to a new project" flow (roles -> schema -> data) with
# preflight checks and the repo's canonical edge-function deploy list.
#
# The agent that generated this file cannot reach the source project, so YOU run
# it with your own credentials. Nothing here reads a secret from the source that
# is not in the connection strings you provide.
#
# ---------------------------------------------------------------------------
# Required environment variables (export before running, or use a .env.clone):
#
#   SOURCE_DB_URL  Postgres connection string of the SOURCE project.
#                  Dashboard -> Project Settings -> Database -> Connection string
#                  -> URI (use the DIRECT connection, port 5432, not the pooler).
#                  Example: postgresql://postgres:PASS@db.<ref>.supabase.co:5432/postgres
#   TARGET_DB_URL  Same, for the NEW (empty) target project.
#
# For the edge-function deploy stage (optional, skip with --no-functions):
#   TARGET_REF               Target project ref (the <ref> in db.<ref>.supabase.co).
#   SUPABASE_ACCESS_TOKEN    Account token from https://supabase.com/dashboard/account/tokens
#
# Optional:
#   SUPABASE_CLI   Override the Supabase CLI invocation (default: "npx --yes supabase").
#   WORKDIR        Where dump files are written (default: ./.supabase-clone).
#   CLONE_ASSUME_YES=1   Skip the interactive confirmation before writing to target.
# ---------------------------------------------------------------------------
set -euo pipefail

# --- options ---------------------------------------------------------------
DO_FUNCTIONS=1
for arg in "$@"; do
  case "$arg" in
    --no-functions) DO_FUNCTIONS=0 ;;
    --yes) CLONE_ASSUME_YES=1 ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed -E 's/^# ?//'
      exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

SUPABASE_CLI="${SUPABASE_CLI:-npx --yes supabase}"
WORKDIR="${WORKDIR:-./.supabase-clone}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# --- preflight -------------------------------------------------------------
log "Preflight"
: "${SOURCE_DB_URL:?Set SOURCE_DB_URL (direct URI of the source project database)}"
: "${TARGET_DB_URL:?Set TARGET_DB_URL (direct URI of the target project database)}"

command -v psql >/dev/null 2>&1 || die "psql not found. Install PostgreSQL client tools (postgresql-client / libpq)."
# The Supabase CLI drives the dumps so Supabase-managed schemas are handled correctly.
$SUPABASE_CLI --version >/dev/null 2>&1 || die "Supabase CLI unavailable. Install it or set SUPABASE_CLI."

if [ "$DO_FUNCTIONS" = "1" ]; then
  : "${TARGET_REF:?Set TARGET_REF for function deploy, or pass --no-functions}"
  : "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN for function deploy, or pass --no-functions}"
fi

mkdir -p "$WORKDIR"
ROLES_SQL="$WORKDIR/roles.sql"
SCHEMA_SQL="$WORKDIR/schema.sql"
DATA_SQL="$WORKDIR/data.sql"

echo "  source : ${SOURCE_DB_URL%%:*}://***@${SOURCE_DB_URL##*@}"
echo "  target : ${TARGET_DB_URL%%:*}://***@${TARGET_DB_URL##*@}"
echo "  workdir: $WORKDIR"

if [ "${CLONE_ASSUME_YES:-0}" != "1" ]; then
  printf '\nThis DUMPS the source and WRITES schema + data into the target project.\n'
  printf 'The target should be a fresh/empty project. Continue? [y/N] '
  read -r reply
  case "$reply" in [yY]*) ;; *) die "Aborted." ;; esac
fi

# --- stage 1: dump source --------------------------------------------------
# Mirrors the official Supabase project-to-project migration flow.
log "Dumping roles from source"
$SUPABASE_CLI db dump --db-url "$SOURCE_DB_URL" -f "$ROLES_SQL" --role-only

log "Dumping schema from source"
$SUPABASE_CLI db dump --db-url "$SOURCE_DB_URL" -f "$SCHEMA_SQL"

log "Dumping data from source (COPY format)"
$SUPABASE_CLI db dump --db-url "$SOURCE_DB_URL" -f "$DATA_SQL" --use-copy --data-only

# --- stage 2: restore into target -----------------------------------------
# session_replication_role=replica defers FK/triggers so data loads regardless
# of insertion order; --single-transaction rolls the whole thing back on error.
log "Restoring roles + schema + data into target"
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$ROLES_SQL" \
  --file "$SCHEMA_SQL" \
  --command 'SET session_replication_role = replica' \
  --file "$DATA_SQL" \
  --dbname "$TARGET_DB_URL"

log "Database clone complete."

# --- stage 3: deploy edge functions ---------------------------------------
if [ "$DO_FUNCTIONS" = "1" ]; then
  # Canonical MiraCare deploy list — kept in sync with scripts/deploy-v2-functions.ps1.
  # line-webhook and stripe-webhook take external callbacks and must skip JWT verification.
  DEFAULT_FUNCTIONS=(
    chat-orchestrator
    fact-extractor
    admin-order-action
    admin-line-reply
    admin-stripe-product-sync
    referrer-order
    referral-bind
    referral-self-provision
    stripe-checkout
    stripe-promptpay-qr
    lab-ingest
    lab-confirm
    wearable-ingest
    pdpa-export
    pdpa-delete
  )
  NO_JWT_FUNCTIONS=(line-webhook stripe-webhook)

  log "Deploying edge functions to $TARGET_REF"
  for fn in "${DEFAULT_FUNCTIONS[@]}"; do
    echo "  deploy $fn"
    $SUPABASE_CLI functions deploy "$fn" --project-ref "$TARGET_REF"
  done
  for fn in "${NO_JWT_FUNCTIONS[@]}"; do
    echo "  deploy $fn (--no-verify-jwt)"
    $SUPABASE_CLI functions deploy "$fn" --project-ref "$TARGET_REF" --no-verify-jwt
  done
else
  warn "Skipping edge-function deploy (--no-functions)."
fi

# --- next steps ------------------------------------------------------------
log "Postgres + functions done. Remaining manual steps (see runbook):"
cat <<'EOF'
  1. Storage FILES are not copied by a DB dump. Run:
         node scripts/clone-supabase-storage.mjs
     (needs SOURCE_URL/SOURCE_SERVICE_ROLE_KEY + TARGET_URL/TARGET_SERVICE_ROLE_KEY).
  2. Function SECRETS must be re-set on the target (they are never dumped):
         supabase secrets set OPENAI_API_KEY=... MIRACARE_PROMPT_ID=... (see runbook checklist)
  3. Auth + project settings (redirect URLs, providers, SMTP, rate limits) are
     platform config, not Postgres — reapply them from the source dashboard.
  4. Point the app at the new project: EXPO_PUBLIC_SUPABASE_URL / PUBLISHABLE_KEY.
EOF
