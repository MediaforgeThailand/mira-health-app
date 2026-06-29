# Chatbot Production Hardening

This note documents the production-oriented chatbot controls added around Gemini, product-card rendering, logs, and health memory.

## Runtime Flow

```text
Expo app
-> Supabase Auth session
-> chat-orchestrator Edge Function
-> MiraCare prompt variables
-> Gemini provider boundary
-> Google Gemini GenerateContent API
-> persistent ai/rag/api logs
-> app chat UI
```

The app must not send full RAG context or prompt overrides from mobile code. In Supabase mode it sends only the user question, short chat history, and user nickname. The Edge Function supplies `brand_name`, `user_nickname`, `personal_context`, `recent_chat`, and `product_catalog`, then calls Gemini through the backend provider boundary.

## Production Tables

- `app_user_roles`: app-level role gate for `admin`, `hospital_staff`, and `user`.
- `prompt_versions`: legacy/local prompt governance table. The production MiraCare chat path does not read it for live replies.
- `ai_request_logs`: persistent model request lifecycle logs.
- `rag_retrieval_logs`: persistent retrieval logs with matched chunk ids and categories.
- `api_process_logs`: persistent Edge Function process logs.
- `health_memory_logs`: persistent personal health memory extraction/save/delete/export/revoke logs.
- `chat_eval_cases`: seeded evaluation cases for prompt/RAG regression tests.
- `ai_rate_limits`: per-user minute buckets used by `increment_ai_rate_limit`.

## Prompt Governance

The Gemini provider boundary is the source of truth for live reply behavior. Prompt/instruction changes must be reviewed, regression-tested, and kept inside the shared backend provider path. Runtime admin prompt overrides should not be layered onto the production chat path.

## Health Memory

Chat-derived personal health facts are stored in the patient health data vault, not in RAG. The current prototype auto-creates `chat_health_memory` consent during authenticated auto-save so the UX stays silent. Before store launch, replace silent consent with an explicit PDPA-ready consent screen and retention controls.

## Verification Checklist

- Run database migrations including `20260605000000_chatbot_production_hardening.sql` and `20260605100000_user_nickname_chat_prompt.sql`.
- Deploy `chat-orchestrator` with JWT verification enabled.
- Confirm publishable-key-only calls return `401`.
- Confirm an authenticated call returns `text`, `requestId`, and `ragMatches`.
- Confirm log rows are written to `ai_request_logs`, `rag_retrieval_logs`, and `api_process_logs`.
- Confirm health fact auto-save writes `health_facts`, `health_fact_sources`, `data_access_logs`, and `health_memory_logs`.
- Run `npm run typecheck`, `npm audit --audit-level=moderate`, and a browser smoke test at `/chatbot`.
