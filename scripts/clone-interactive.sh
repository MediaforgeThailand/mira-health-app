#!/usr/bin/env bash
#
# clone-interactive.sh — Guided, prompt-driven wrapper around the Supabase clone
# toolkit. It runs ENTIRELY ON YOUR machine: it asks you for the source/target
# credentials in your own terminal (secrets are read hidden — never echoed, never
# sent anywhere), then runs the full clone end to end by delegating to the two
# existing scripts:
#   1) DB roles+schema+data + edge-function deploy   -> clone-supabase-project.sh
#   2) storage object copy                           -> clone-supabase-storage.mjs
#   3) schema-diff verification
#
# It does NOT set function secrets or auth/project config — those stay manual
# (see docs/pkm-shop-clone-runbook.md steps E-F); it prints a reminder at the end.
#
# Prereqs: bash (Git Bash on Windows), Supabase CLI (npx --yes supabase),
#          PostgreSQL client (psql/pg_dump), node.
# Run:  bash scripts/clone-interactive.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_CLI="${SUPABASE_CLI:-npx --yes supabase}"

head() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ask VAR "prompt" [secret]  — loops until non-empty; hides input when secret.
ask() {
  local __var="$1" __prompt="$2" __secret="${3:-}" __val=""
  while [ -z "$__val" ]; do
    if [ -n "$__secret" ]; then
      read -rs -p "  $__prompt: " __val; echo
    else
      read -r  -p "  $__prompt: " __val
    fi
    [ -z "$__val" ] && warn "ต้องไม่ว่าง / cannot be empty — ลองใหม่"
  done
  printf -v "$__var" '%s' "$__val"
}

cat <<'INTRO'
──────────────────────────────────────────────────────────────────────────
 Supabase clone — guided wrapper
 รันบนเครื่องคุณเอง / runs on YOUR machine. พิมพ์ค่าตามที่ถาม —
 ค่าที่เป็นความลับจะถูกซ่อนและไม่ถูกส่งออกไปไหน (secrets are hidden).
 เตรียม: สำหรับทั้ง 2 project ต้องมี direct DB URI (Settings > Database >
 Connection string > URI, port 5432) และ service_role key (Settings > API),
 กับ Supabase account access token.
──────────────────────────────────────────────────────────────────────────
INTRO

head "Source — mira-health (โปรเจกต์ต้นทางที่จะ clone มา)"
ask SOURCE_DB_URL "SOURCE_DB_URL  (postgresql://postgres:PASS@db.<ref>.supabase.co:5432/postgres)" secret
ask SOURCE_URL    "SOURCE_URL     (https://<ref>.supabase.co)"
ask SOURCE_SERVICE_ROLE_KEY "SOURCE service_role key" secret

head "Target — PKM Shop (โปรเจกต์ใหม่ที่ยังว่าง)"
ask TARGET_DB_URL "TARGET_DB_URL  (postgresql://postgres:PASS@db.<ref>.supabase.co:5432/postgres)" secret
ask TARGET_URL    "TARGET_URL     (https://<ref>.supabase.co)"
ask TARGET_SERVICE_ROLE_KEY "TARGET service_role key" secret
ask SUPABASE_ACCESS_TOKEN   "Supabase account access token (สำหรับ deploy functions)" secret

# Derive the target project ref from its URL; ask only if it can't be parsed.
TARGET_REF="$(printf '%s' "$TARGET_URL" | sed -E 's#^https?://([^./]+)\..*#\1#')"
[ -n "$TARGET_REF" ] && [ "$TARGET_REF" != "$TARGET_URL" ] || ask TARGET_REF "TARGET_REF (project ref)"

export SOURCE_DB_URL SOURCE_URL SOURCE_SERVICE_ROLE_KEY
export TARGET_DB_URL TARGET_URL TARGET_SERVICE_ROLE_KEY TARGET_REF SUPABASE_ACCESS_TOKEN

head "Summary — ตรวจก่อนเริ่ม"
info "source : $SOURCE_URL"
info "target : $TARGET_URL  (ref $TARGET_REF)"
info "ขั้นตอนนี้จะ DUMP ต้นทาง แล้ว WRITE schema + data ลงปลายทาง (ควรเป็นโปรเจกต์ว่าง)"
printf '\n  Proceed / ไปต่อ? [y/N] '; read -r reply
case "$reply" in [yY]*) ;; *) die "ยกเลิก / aborted" ;; esac

head "Step 1/3 — database + edge functions"
# The child script has its own confirmation; we already confirmed above.
CLONE_ASSUME_YES=1 bash "$SCRIPT_DIR/clone-supabase-project.sh"

head "Step 2/3 — storage objects"
node "$SCRIPT_DIR/clone-supabase-storage.mjs"

head "Step 3/3 — schema-diff verification"
if diff \
     <($SUPABASE_CLI db dump --db-url "$SOURCE_DB_URL" --schema-only 2>/dev/null) \
     <($SUPABASE_CLI db dump --db-url "$TARGET_DB_URL" --schema-only 2>/dev/null) \
     > clone-schema.diff 2>&1; then
  rm -f clone-schema.diff
  info "schema identical ✔"
else
  warn "schema differs — see ./clone-schema.diff"
fi

head "เสร็จ / Done — ขั้นที่ยังต้องทำเอง (ดู docs/pkm-shop-clone-runbook.md)"
cat <<EOF
  1. ตั้ง function secrets ที่ปลายทาง (ไม่ถูก copy มา):
       $SUPABASE_CLI secrets set --project-ref $TARGET_REF OPENAI_API_KEY=... (ฯลฯ)
  2. ก็อป Auth URL config / providers / SMTP จาก dashboard ต้นทาง
  3. ชี้ .env ของแอป PKM-Shop ไปที่ $TARGET_URL
EOF
