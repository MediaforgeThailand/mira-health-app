import { formatCatalogEntries, renderPersonalContextRows, renderRecentChatRows } from '../context.ts';
import type { ChatMessageRow, FactKeyRow, UserFactRow } from '../types.ts';

declare const Deno: {
  test: (name: string, fn: () => void) => void;
};

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function message(id: string, role: 'assistant' | 'user', content: string): ChatMessageRow {
  return {
    client_msg_id: role === 'user' ? id : null,
    content,
    created_at: `2026-06-11T00:00:0${id.slice(-1)}Z`,
    id,
    marker_product_ids: [],
    openai_response_id: null,
    role,
    session_id: 'session',
  };
}

const emptyPersonalContext = '\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e2a\u0e48\u0e27\u0e19\u0e15\u0e31\u0e27\u0e17\u0e35\u0e48\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19';
const missingConsentLine = '\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49\u0e02\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e22\u0e34\u0e19\u0e22\u0e2d\u0e21\u0e40\u0e01\u0e47\u0e1a\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25';
const factRegistry: FactKeyRow[] = [
  { key: 'age', unit: 'year', value_kind: 'number' },
  { key: 'nickname', unit: null, value_kind: 'text' },
];

function fact(overrides: Partial<UserFactRow>): UserFactRow {
  return {
    confidence: 0.9,
    created_at: '2026-06-11T00:00:00Z',
    customer_id: 'customer',
    id: 'fact',
    key: 'age',
    source: 'chat_extraction',
    source_ref: 'message',
    status: 'active',
    superseded_by: null,
    tenant_id: 'tenant',
    value_num: 35,
    value_text: null,
    ...overrides,
  };
}

Deno.test('renderRecentChatRows returns empty Thai fallback', () => {
  assert(renderRecentChatRows([]) === 'ไม่มีแชทล่าสุด', 'expected empty recent chat fallback');
});

Deno.test('renderRecentChatRows renders oldest to newest', () => {
  const rendered = renderRecentChatRows([
    message('m1', 'user', 'สวัสดี'),
    message('m2', 'assistant', 'สวัสดีค่ะ'),
  ]);

  assert(rendered === 'User: สวัสดี\nAssistant: สวัสดีค่ะ', 'expected ordered rendered chat');
});

Deno.test('renderRecentChatRows drops oldest rows over budget', () => {
  const rows = [
    message('m1', 'user', 'a'.repeat(100)),
    message('m2', 'assistant', 'b'.repeat(100)),
    message('m3', 'user', 'short'),
    message('m4', 'assistant', 'ok'),
  ];
  const rendered = renderRecentChatRows(rows, 60);

  assert(!rendered.includes('a'.repeat(20)), 'expected oldest over-budget pair to be dropped');
  assert(rendered.includes('User: short'), 'expected latest user message to remain');
});

Deno.test('renderPersonalContextRows returns empty fallback when nothing exists and consent is already present', () => {
  const rendered = renderPersonalContextRows({
    activeFacts: [],
    candidateFacts: [],
    hasConsent: true,
    orderContext: null,
    registry: factRegistry,
  });

  assert(rendered === emptyPersonalContext, 'expected empty personal context fallback');
});

Deno.test('renderPersonalContextRows renders facts, candidate facts, order, then missing consent in order', () => {
  const rendered = renderPersonalContextRows({
    activeFacts: [fact({ key: 'age', value_num: 35 })],
    candidateFacts: [fact({ confidence: 0.55, id: 'candidate', key: 'nickname', status: 'candidate', value_num: null, value_text: 'Boss' })],
    hasConsent: false,
    orderContext: 'ORDER_CONTEXT',
    registry: factRegistry,
  });
  const lines = rendered.split('\n');

  assert(lines.length === 4, `expected four context lines, got ${lines.length}: ${rendered}`);
  assert(lines[0].includes('35'), 'expected active facts first');
  assert(lines[1].includes('Boss'), 'expected candidate facts second');
  assert(lines[2].includes('ORDER_CONTEXT'), 'expected active order context third');
  assert(lines[3] === missingConsentLine, 'expected missing consent line last');
});

Deno.test('formatCatalogEntries omits image url but keeps full descriptions', () => {
  const longDescription = 'x'.repeat(500);
  const [entry] = formatCatalogEntries([
    { catalog_key: 'chk-basic', category: 'checkup', description: longDescription, name: 'Basic', price_baht: 1990 },
  ]);

  assert(!Object.keys(entry).includes('image'), 'catalog entry must not include an image url');
  assert(entry.description === longDescription, 'description must be kept in full (clipping it broke intake)');
  assert(entry.id === 'chk-basic', 'id should map from catalog_key');
});
