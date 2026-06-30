# Supabase AI Connection Guide

Updated: 2026-06-29

This document is for AI agents and developers working on Mira. It explains how the app connects to Supabase, how the Gemini chatbot provider is configured, and which secrets must never be exposed in client code.

## Current Architecture

```text
Expo / web app
-> Supabase client
-> Supabase Edge Function: chat-orchestrator
-> tenant catalog + personal context + recent chat + order context
-> Google Gemini GenerateContent API
-> app chat UI / LINE replies
```

The client does not call Gemini directly and does not send client-built prompt context to the model. Gemini credentials, catalog/context assembly, rate limiting, order state, and AI/API process logs stay inside Supabase Edge Functions and database infrastructure.

## Important Files

- Client chat adapter: `lib/ai/miraChat.ts`
- Primary chat surface: `app/prototype.tsx`
- Shared API types: `lib/types/api.ts`
- Chat Edge Function: `supabase/functions/chat-orchestrator/index.ts`
- LINE Edge Function using the same orchestrator: `supabase/functions/line-webhook/index.ts`
- Shared orchestrator: `supabase/functions/_shared/orchestrate.ts`
- Shared Gemini provider boundary: `supabase/functions/_shared/openai.ts`
- Fact extraction Edge Function: `supabase/functions/fact-extractor/index.ts`
- RAG embedding Edge Function: `supabase/functions/rag-embed/index.ts`

The file `supabase/functions/_shared/openai.ts` keeps its legacy filename to avoid a broad import churn, but the live implementation calls Gemini.

## Required `.env.local`

Create `.env.local` in the project root. Do not commit it.

```env
EXPO_PUBLIC_SUPABASE_URL=https://xwixdxmemwcuoamcloty.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
EXPO_PUBLIC_GEMINI_MODEL=gemini-3.5-flash
EXPO_PUBLIC_USER_NICKNAME=customer
EXPO_PUBLIC_AI_PROXY_URL=
SUPABASE_ACCESS_TOKEN=your_supabase_cli_access_token
```

Notes:

- `EXPO_PUBLIC_*` values are bundled into the client app. Only put public values there.
- `SUPABASE_ACCESS_TOKEN` is for the Supabase CLI deploy workflow only.
- Do not add `EXPO_PUBLIC_GEMINI_API_KEY` or `EXPO_PUBLIC_GOOGLE_API_KEY`.
- Do not put Supabase service-role keys in Expo/web env files.

## Supabase Secrets

Set Gemini secrets in Supabase, not in the client app:

```bash
npx supabase secrets set GEMINI_API_KEY=your_google_gemini_api_key_here --project-ref xwixdxmemwcuoamcloty
npx supabase secrets set GEMINI_MODEL=gemini-3.5-flash --project-ref xwixdxmemwcuoamcloty
npx supabase secrets set GEMINI_EXTRACT_MODEL=gemini-3.5-flash --project-ref xwixdxmemwcuoamcloty
```

Optional:

```bash
npx supabase secrets set GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta --project-ref xwixdxmemwcuoamcloty
```

Existing `GEMINI_API_KEY` and `GEMINI_MODEL` secrets can also be used by `rag-embed`; embedding model/dimension changes still require coordinated database and re-embedding work.

## Deploy Edge Functions

Deploy the functions that use the shared Gemini provider boundary:

```powershell
cd "C:\Users\taksi\Documents\Mira Application"
npx supabase functions deploy chat-orchestrator --project-ref xwixdxmemwcuoamcloty
npx supabase functions deploy line-webhook --project-ref xwixdxmemwcuoamcloty
npx supabase functions deploy fact-extractor --project-ref xwixdxmemwcuoamcloty
```

Current behavior:

- The app must have a Supabase Auth session before calling `chat-orchestrator`.
- `line-webhook` uses the same shared orchestration engine for LINE messages.
- Backend loads tenant catalog, personal context, recent chat, and order context before calling Gemini.
- Live replies do not read `prompt_versions`.
- Per-user/session rate limiting and order transitions stay in the backend, not in model text.

## Verify Function Endpoint

Use a short authenticated test request. Do not print secrets.

```powershell
$vars = @{}
Get-Content .env.local | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $vars[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
  }
}

$uri = $vars['EXPO_PUBLIC_SUPABASE_URL'].TrimEnd('/') + '/functions/v1/chat-orchestrator'
$anon = $vars['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
$userJwt = 'paste_authenticated_user_access_token_here'
$body = @{
  message = 'สวัสดี'
  channel = 'app'
  client_msg_id = [guid]::NewGuid().ToString()
  tenant_slug = 'mira'
} | ConvertTo-Json -Depth 5

$res = Invoke-WebRequest `
  -Method Post `
  -Uri $uri `
  -Headers @{ Authorization = "Bearer $userJwt"; apikey = $anon; 'Content-Type' = 'application/json' } `
  -Body $body `
  -TimeoutSec 90 `
  -SkipHttpErrorCheck

$res.StatusCode
$res.Content
```

Expected result:

- `200`
- JSON body with `text`, `session_id`, optional `cards`, and optional `order`

Common errors:

- `404`: function is not deployed to that Supabase project.
- `401 UNAUTHORIZED_INVALID_JWT_FORMAT` or `Missing authenticated user JWT`: the caller is sending a publishable key or missing user JWT instead of an authenticated user's access token.
- `500 Missing GEMINI_API_KEY or GOOGLE_API_KEY`: Gemini secret is not set on the Edge Function.

## How The App Chooses AI Backend

`lib/ai/miraChat.ts` follows this order:

1. If `EXPO_PUBLIC_AI_PROXY_URL` is set, call that external proxy.
2. Otherwise, if Supabase public config exists, call `supabase.functions.invoke('chat-orchestrator')`.
3. If neither exists, show local fallback text only.

For the Supabase path, the client sends the authenticated question/action payload only. The Edge Function loads real catalog, order context, recent chat, and personal context, calls Gemini, strips markers, and returns public UI cards/order state.

## Security Rules For AI Agents

- Never print `.env.local` values.
- Never add `EXPO_PUBLIC_GEMINI_API_KEY` or `EXPO_PUBLIC_GOOGLE_API_KEY`.
- Never place `GEMINI_API_KEY`, `GOOGLE_API_KEY`, Supabase service-role key, or `SUPABASE_ACCESS_TOKEN` in committed files.
- Do not use service-role keys in Expo, React Native, or browser code.
- Keep Supabase Auth JWT required on `chat-orchestrator`.
- Keep rate limiting enabled before public launch.
- Log model/process events without logging full personal health data.

## RAG Notes

The app still keeps local fallback RAG chunks for offline preview. In normal Supabase mode, `chat-orchestrator` uses backend catalog/context and sends the bounded provider instruction to Gemini.

Before using real medical content:

- Use only whitelisted sources.
- Store source URL, reviewer, last reviewed date, expiry date, and risk level.
- Have a qualified medical reviewer approve chunks before activation.
- Keep summaries short and route only relevant context into the model.
- Keep emergency escalation rules in the provider instruction, not only in RAG content.

See `docs/rag-source-plan.md` for recommended source strategy.
See `docs/patient-health-data-vault.md` for user-specific health memory, consent, and audit rules.
