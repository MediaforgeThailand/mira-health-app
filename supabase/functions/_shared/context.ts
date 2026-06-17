import { selectMany, selectOne } from './db.ts';
import { renderFactsThai } from './facts.ts';
import type { ChatMessageRow, FactKeyRow, UserFactRow } from './types.ts';

const EMPTY_RECENT_CHAT = 'ไม่มีแชทล่าสุด';
const EMPTY_PERSONAL_CONTEXT = 'ยังไม่มีข้อมูลส่วนตัวที่ยืนยัน';
const MISSING_CONSENT_LINE = '\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49\u0e02\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e22\u0e34\u0e19\u0e22\u0e2d\u0e21\u0e40\u0e01\u0e47\u0e1a\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25';

function clipToBudget(messages: ChatMessageRow[], budget: number) {
  let clipped = [...messages];

  while (clipped.length > 0) {
    const rendered = renderMessages(clipped);

    if (rendered.length <= budget) {
      return rendered;
    }

    clipped = clipped.slice(Math.min(2, clipped.length));
  }

  return EMPTY_RECENT_CHAT;
}

function renderMessages(messages: ChatMessageRow[]) {
  return messages
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n');
}

export function renderRecentChatRows(messages: ChatMessageRow[], budget = 1500) {
  if (messages.length === 0) {
    return EMPTY_RECENT_CHAT;
  }

  return clipToBudget(messages.slice(-8), budget);
}

export async function buildRecentChat(sessionId: string) {
  const rows = await selectMany<ChatMessageRow>('chat_messages', {
    order: 'created_at.desc',
    role: 'in.(user,assistant)',
    select: 'id,session_id,role,content,marker_product_ids,openai_response_id,client_msg_id,created_at',
    session_id: `eq.${sessionId}`,
    limit: '8',
  });
  const ordered = rows.reverse();

  return renderRecentChatRows(ordered);
}

export function renderPersonalContextRows({
  activeFacts,
  candidateFacts,
  hasConsent,
  orderContext,
  registry,
}: {
  activeFacts: UserFactRow[];
  candidateFacts: UserFactRow[];
  hasConsent: boolean;
  orderContext?: string | null;
  registry: FactKeyRow[];
}) {
  const renderedFacts = renderFactsThai(activeFacts, candidateFacts, registry);
  const lines = [
    renderedFacts.activeLine,
    renderedFacts.candidateLine,
    orderContext ?? '',
    hasConsent ? '' : MISSING_CONSENT_LINE,
  ].filter(Boolean);

  return lines.length ? lines.join('\n') : EMPTY_PERSONAL_CONTEXT;
}

export async function buildPersonalContext(customerId: string, orderContext?: string | null, suppressConsentPrompt = false) {
  const activeFacts = await selectMany<UserFactRow>('user_facts', {
    customer_id: `eq.${customerId}`,
    limit: '20',
    order: 'created_at.desc',
    select: 'id,tenant_id,customer_id,key,value_text,value_num,confidence,status,source,source_ref,superseded_by,created_at',
    status: 'eq.active',
  });
  const candidateFacts = await selectMany<UserFactRow>('user_facts', {
    customer_id: `eq.${customerId}`,
    limit: '2',
    order: 'confidence.desc',
    select: 'id,tenant_id,customer_id,key,value_text,value_num,confidence,status,source,source_ref,superseded_by,created_at',
    status: 'eq.candidate',
  });
  const registry = await selectMany<FactKeyRow>('fact_keys', {
    select: 'key,value_kind,unit',
  });
  const latestConsent = await selectOne<{ granted: boolean }>('consents', {
    customer_id: `eq.${customerId}`,
    kind: 'eq.health_data_collection',
    order: 'created_at.desc',
    select: 'granted',
  });

  return renderPersonalContextRows({
    activeFacts,
    candidateFacts,
    // V3-7: on LINE the operator manages consent themselves, so don't surface the
    // "missing consent" line that prompts Mira to ask for it.
    hasConsent: suppressConsentPrompt || Boolean(latestConsent),
    orderContext,
    registry,
  });
}

export function inferIntentCategory(message: string): 'checkup' | 'vaccine' | null {
  const normalized = message.toLowerCase();

  if (normalized.includes('วัคซีน') || normalized.includes('ฉีด') || normalized.includes('vaccine')) {
    return 'vaccine';
  }

  if (normalized.includes('ตรวจ') || normalized.includes('checkup') || normalized.includes('blood')) {
    return 'checkup';
  }

  return null;
}

// Drop ONLY the image URL from the model context: the app renders product cards
// (image) from the DB by id (see orchestrate.ts), so image URLs are pure
// input-token waste the model never uses. Keep the FULL description — the model
// relies on it to choose and talk about products; clipping it (the earlier #28
// attempt) starved the model of product detail and made it over-ask during
// intake (~44% asked >1 question), so descriptions are intentionally NOT clipped.
export function formatCatalogEntries(
  rows: Array<{ catalog_key: string; category: string; description: string; name: string; price_baht: number }>,
) {
  return rows.map((row) => ({
    category: row.category,
    description: row.description,
    id: row.catalog_key,
    name: row.name,
    price: row.price_baht,
  }));
}

export async function buildCatalogJson(tenantId: string, intentCategory?: 'checkup' | 'vaccine' | null) {
  const rows = await selectMany<{
    catalog_key: string;
    category: string;
    description: string;
    name: string;
    price_baht: number;
  }>('products', {
    active: 'eq.true',
    limit: '80',
    order: 'created_at.desc',
    select: 'catalog_key,name,description,price_baht,category,created_at',
    tenant_id: `eq.${tenantId}`,
  });
  const filtered = rows.length > 50 && intentCategory
    ? rows.filter((row) => (row as { category?: string }).category === intentCategory).slice(0, 50)
    : rows.slice(0, 50);

  return JSON.stringify(formatCatalogEntries(filtered));
}
