# MiraCare v2 Local Readiness

Updated: 2026-06-11

This file separates work that can be hardened locally from work that needs an owner decision or external setup. This file should not list secret values.

## Local Work Completed Without External Setup

- `npm run v2:local-readiness-audit` now checks that `docs/v2-gap-analysis.md` has no unblocked `Missing` rows, that this file keeps owner/external blockers visible, and that external preflight is not confused with seeded/live proof.
- `npm run v2:verify` now includes `v2:local-readiness-audit` so local readiness hygiene runs with the deterministic verification bundle.
- GitHub Actions now runs the same local readiness audit on v2 pull requests.
- Additional shared Deno tests cover local-only helper behavior for LINE tenant env fallback, LINE empty-product handling, referral attribution boundaries, and core order/referral helpers.
- `npm run v2:external-preflight` remains the safe way to check external prerequisites without printing secrets; it does not prove seeded/live regressions passed.
- GitHub Actions `live-regression` is allowed to pass as skipped until `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `MIRA_DEMO_PROMPTPAY_ID` are configured as repository secrets. A green skipped job is not CI live proof.
- `npm run v2:e2e-commerce` now covers the direct purchase, admin confirm, referred purchase, PromptPay CRC, and commission snapshot path once the live demo tenant is seeded with `chk-basic` and `promptpay_id`.
- OpenAI Platform prompt verification is owner-owned: the published prompt `pmpt_6a29c7e353b88196a6e648b24c54849e0f6204e24d65c021` v2 default was authored and behavior-tested in the Platform playground by the owner's agent on 2026-06-10/11, and the owner reports the live 7-case regression passes against it. Codex must not fetch or verify prompt content from code.

## No Unblocked Missing Rows

The current gap analysis has no `Missing` rows. Remaining unfinished items are either `Partial` pending live proof or `Blocked` because the spec does not define a safe contract. The authoritative blocker list remains `docs/v2-open-questions.md`.

Local work that is still safe without external setup should be added as a concrete audit/test/doc task here before implementation. Product behavior changes must stay in `docs/v2-open-questions.md` until the owner answers the contract.

## Still Blocked By Owner Decision

- No active owner-decision blockers remain for the AI Sales / Referral / Admin scope.

## Still Blocked By External Setup

These are the five external preflight gates that can be checked locally but cannot be completed without outside credentials/state:

- seed-demo service role setup
- seeded chat regression setup (uses programmatic `regression-test@miracare.dev` JWT bootstrap; no human-managed `TEST_SUPABASE_JWT`)
- live RLS project setup
- live commerce E2E setup (uses disposable `e2e-*@miracare.dev` identities; requires demo `chk-basic` and `MIRA_DEMO_PROMPTPAY_ID` or an already configured tenant `promptpay_id`)
- LINE sandbox setup, documented in `docs/line-setup.md`
