# Health Chat Companion

Mira chat is designed as one continuous health companion timeline, not a generic multi-thread AI chat. The mobile app can still keep local UI messages, but production persistence should use `chat_sessions.source = companion_timeline` and `chat_messages.metadata.timeline = single_companion`.

## Runtime Contract

`mira-chat` remains the main Edge Function and now returns a structured payload:

- `text`: short user-facing Thai answer.
- `intent`: `small_talk`, `health_advice`, `product_recommendation`, `product_compare`, `booking`, `checkout`, `safety_escalation`, or `off_topic`.
- `uiCards`: product grid, branch/location, checkout draft, or memory saved cards.
- `memoryWrites`: saved or skipped agent-memory items.
- `contextAssessment`: score 0-100 for whether Mira knows enough to recommend a package, with `mode = ask_context | direct_product | personalized_recommendation`.
- `nextActions`: lightweight action hints for the app UI.
- `ragMatches`: approved public/product/policy RAG chunks used for the answer.
- `routerMeta`: backend-owned retrieval decision, including selected routes, rejected routes, and router latency.
- `searchSources`: approved public sources surfaced from controlled web search.

The mobile app should never send full RAG or personal memory context. The Edge Function owns retrieval, prompt assembly, logging, and structured action selection.

## Router-First Retrieval

Every turn runs through a backend router before retrieval. The router decides which context sources are allowed:

- `recent_chat`: when the user references prior conversation.
- `personal_memory_deep`: when consent exists and the answer may depend on durable user context.
- `product_rag`: direct product/package requests or ready personalized recommendations.
- `policy_rag`: booking, payment, consent, referral, and call-center questions.
- `controlled_web_search`: prototype fallback for general medical knowledge when internal medical RAG is missing.
- `emergency`: urgent symptoms; do not retrieve or sell products.
- `none`: current message plus already loaded context is enough.

Broad requests like "อยากตรวจสุขภาพ" should not route to `product_rag` until context is sufficient. They should ask one useful context question first.

## Context Boundaries

- Personal memory: `health_facts` and `agent_memory`, only after `chat_health_memory` consent is granted.
- Product knowledge: canonical `products` and `rag_chunks` with `category = marketplace.product`.
- Policy and safety knowledge: booking, payment, consent, referral, and safety RAG categories.
- Controlled web search: `web_search_sources` allowlists trusted domains; returned sources are filtered again before being exposed to the app.

Personal health data must not be written into RAG. It belongs in the health data vault and must remain user-scoped through RLS.

## Persistence And Audit

- `chat_sessions.rolling_summary` keeps a compact companion timeline summary so future turns can avoid repeated questions even when the app sends a short message list.
- `chat_messages.router_route` stores the routes used for that message.
- `retrieval_logs` records router input, selected/rejected routes, fetch counts, cache status, latency, and context token estimates.
- `web_search_sources` and `web_search_cache` are the governance layer for fail-safe public medical search.

## Product Flow

The AI chat reads product cards from canonical `products` through the backend response. If Supabase has no active products, the app should show an explicit empty/setup state instead of falling back to local package fixtures.

Expected flow:

1. User asks broadly for a checkup.
2. Mira first checks confirmed memory and the recent companion timeline so the reply feels like it knows whether the user is new or returning.
3. If the user greets and broadly asks for a checkup, Mira greets back, then asks about the latest checkup unless prior history already shows the user has not checked recently.
4. If the user answers "I don't remember" after a latest-checkup question, Mira treats the latest-checkup slot as answered unknown and moves to the next missing context instead of repeating the same question.
5. If context score is below 85, or key slots like latest checkup and location/budget are missing, chat asks one short follow-up question and returns no product card.
6. If the user asks for a specific service, or context score is truly ready, chat returns product cards from canonical `products`.
7. Personalized recommendations show one product card; direct browsing can show up to four.
8. User taps a product, sees one `branch_location` card, then lands on checkout with `productId` and `branchId`.

## Memory Rules

Auto-save is silent only after consent exists. If consent is missing or revoked, chat can answer but must not persist personal memory. Low-confidence health facts are skipped. Users can export, revoke, and delete both confirmed health facts and agent memory from the profile screen.

Context scores follow the same consent rule. Without `chat_health_memory` consent, the score can be used transiently for the current answer but must not be written to `user_context_scores`.
