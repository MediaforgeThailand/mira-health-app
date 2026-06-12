import type { RagMatch } from '@/lib/rag/retriever';
import { invokeFunction } from '@/lib/api/client';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import type {
  ChatAction,
  ChatCard,
  ChatMessageRow,
  ChatOrchestratorRequest,
  ChatOrchestratorResponse,
  ChatProduct,
  ChatSlipUploadResponse,
  OrderPanelState,
  ProductSummary,
  StripeCheckoutRequest,
  StripeCheckoutResponse,
} from '@/lib/types/api';
import { readStoredReferralCode } from '@/lib/referrals/attribution';
import type {
  ChatContextAssessment,
  ChatMemoryWrite,
  ChatNextAction,
  ChatRetrievalRoute,
  ChatRouterMeta,
  ChatSearchSource,
  ChatUiCard,
  HealthChatIntent,
} from './healthChatTypes';
import { createNaturalHealthFallbackAnswer } from './prototypeConversationPolicy';

export type ChatRole = 'user' | 'assistant' | 'system_notice';

export type ChatMessage = {
  cards?: ChatCard[];
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  order?: OrderPanelState;
  sources?: ChatSource[];
  uiCards?: ChatUiCard[];
};

export type ChatSource = Pick<RagMatch, 'category' | 'id' | 'riskLevel' | 'score' | 'source' | 'sourceUrl' | 'summary' | 'title' | 'topic'>;

export type PromptVersionInfo = {
  id: string;
  versionKey: string;
};

export type AskAiResult = {
  contextAssessment?: ChatContextAssessment;
  finishReason?: string;
  intent?: HealthChatIntent;
  latencyMs: number;
  memoryWrites: ChatMemoryWrite[];
  mode: 'external-proxy' | 'supabase-edge-function';
  model: string;
  nextActions: ChatNextAction[];
  promptVersion?: PromptVersionInfo | null;
  ragMatches: ChatSource[];
  requestId?: string;
  routerMeta?: ChatRouterMeta;
  searchSources: ChatSearchSource[];
  sessionId?: string | null;
  responseRole?: ChatRole;
  cards: ChatCard[];
  text: string;
  order?: OrderPanelState;
  uiCards: ChatUiCard[];
};

export type SlipUploadFile = Blob & {
  name?: string;
  type?: string;
};

const FALLBACK_USER_NICKNAME = '\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32';

export const DEFAULT_USER_NICKNAME = process.env.EXPO_PUBLIC_USER_NICKNAME?.trim() || FALLBACK_USER_NICKNAME;

export function formatUserDisplayName(userNickname = DEFAULT_USER_NICKNAME) {
  const nickname = userNickname.trim() || FALLBACK_USER_NICKNAME;

  return nickname.startsWith('คุณ') ? nickname : `คุณ${nickname}`;
}

export const aiChatConfig = {
  model: process.env.EXPO_PUBLIC_OPENAI_MODEL ?? 'gpt-5.5',
  proxyUrl: process.env.EXPO_PUBLIC_AI_PROXY_URL,
};

const hasExternalProxy = Boolean(aiChatConfig.proxyUrl);
const hasSupabaseProxy = supabaseConfigStatus.isConfigured;
export const defaultTenantSlug = process.env.EXPO_PUBLIC_MIRA_TENANT_SLUG?.trim() || 'demo-hospital';
let orchestratorSessionId: string | null = null;

export const aiChatConfigStatus = {
  model: aiChatConfig.model,
  hasProxy: hasExternalProxy || hasSupabaseProxy,
  hasSupabaseProxy,
  mode: hasSupabaseProxy ? 'supabase-edge-function' : hasExternalProxy ? 'external-proxy' : 'offline',
};

const chatMessageSelect = 'id,session_id,role,content,marker_product_ids,cards,openai_response_id,client_msg_id,created_at';
const chatHistoryPageSize = 40;

type LatestChatSessionRow = {
  created_at: string;
  id: string;
  last_message_at: string | null;
};

type ConsentRow = {
  created_at: string;
  granted: boolean;
  id: string;
};

export type ChatHistoryPage = {
  hasMore: boolean;
  messages: ChatMessage[];
  nextBefore: string | null;
  sessionId: string | null;
};

export type HealthDataConsentState = {
  checkedAt: string | null;
  consentId: string | null;
  granted: boolean;
};

export const chatHistoryQueryKeys = {
  consent: () => ['mira-chat', defaultTenantSlug, 'health-data-consent'] as const,
  latest: () => ['mira-chat', defaultTenantSlug, 'latest-history'] as const,
  page: (sessionId: string, before: string | null) => ['mira-chat', defaultTenantSlug, 'history-page', sessionId, before ?? 'latest'] as const,
};

export function getCurrentChatSessionId() {
  return orchestratorSessionId;
}

export function setCurrentChatSessionId(sessionId: string | null) {
  orchestratorSessionId = sessionId;
}

export async function loadLatestChatHistoryPage(pageSize = chatHistoryPageSize): Promise<ChatHistoryPage> {
  if (!hasSupabaseProxy) {
    return {
      hasMore: false,
      messages: [],
      nextBefore: null,
      sessionId: null,
    };
  }

  const { data, error } = await supabase
    .from('chat_sessions')
    .select('id,last_message_at,created_at')
    .eq('channel', 'app')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  const [session] = ((data ?? []) as LatestChatSessionRow[]);

  if (!session) {
    setCurrentChatSessionId(null);

    return {
      hasMore: false,
      messages: [],
      nextBefore: null,
      sessionId: null,
    };
  }

  setCurrentChatSessionId(session.id);

  return loadChatHistoryPage(session.id, { pageSize });
}

export async function loadChatHistoryPage(
  sessionId: string,
  {
    before,
    pageSize = chatHistoryPageSize,
  }: {
    before?: string | null;
    pageSize?: number;
  } = {},
): Promise<ChatHistoryPage> {
  let query = supabase
    .from('chat_messages')
    .select(chatMessageSelect)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(pageSize + 1);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data ?? []) as ChatMessageRow[]);
  const visibleRows = rows.slice(0, pageSize).reverse();
  const messages = await rowsToChatMessages(visibleRows);
  const oldestVisible = visibleRows[0]?.created_at ?? null;

  return {
    hasMore: rows.length > pageSize,
    messages,
    nextBefore: rows.length > pageSize ? oldestVisible : null,
    sessionId,
  };
}

export async function loadHealthDataConsent(): Promise<HealthDataConsentState> {
  if (!hasSupabaseProxy) {
    return {
      checkedAt: null,
      consentId: null,
      granted: false,
    };
  }

  const { data, error } = await supabase
    .from('consents')
    .select('id,granted,created_at')
    .eq('kind', 'health_data_collection')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const consent = data as ConsentRow | null;

  return {
    checkedAt: consent?.created_at ?? null,
    consentId: consent?.id ?? null,
    granted: consent?.granted === true,
  };
}

export async function refreshActiveOrderPanel(sessionId?: string | null): Promise<ChatOrchestratorResponse> {
  const result = await invokeFunction<ChatOrchestratorRequest, ChatOrchestratorResponse>('chat-orchestrator', {
    action: {
      type: 'refresh_order',
    },
    channel: 'app',
    client_msg_id: crypto.randomUUID(),
    message: '',
    ref_code: readStoredReferralCode() ?? undefined,
    session_id: sessionId ?? orchestratorSessionId,
    tenant_slug: defaultTenantSlug,
  });

  orchestratorSessionId = result.session_id;

  return result;
}

async function callSupabaseOrchestrator({
  action,
  question,
  sessionId,
}: {
  action?: ChatAction | null;
  question: string;
  sessionId?: string | null;
}): Promise<AskAiResult> {
  const startedAt = Date.now();

  const result = await invokeFunction<ChatOrchestratorRequest, ChatOrchestratorResponse>('chat-orchestrator', {
    action: action ?? null,
    channel: 'app',
    client_msg_id: crypto.randomUUID(),
    message: question,
    ref_code: readStoredReferralCode() ?? undefined,
    session_id: sessionId ?? orchestratorSessionId,
    tenant_slug: defaultTenantSlug,
  });
  orchestratorSessionId = result.session_id;
  const text = result.text.trim();
  const legacyUiCards = productsToUiCards(result.products);
  const uiCards = apiCardsToUiCards(result.cards, legacyUiCards);

  if (!text) {
    throw new Error('AI proxy returned an empty response.');
  }

  return {
    contextAssessment: undefined,
    finishReason: undefined,
    intent: uiCards.some((card) => card.type === 'product_grid') ? 'product_recommendation' : result.order ? 'checkout' : undefined,
    latencyMs: Date.now() - startedAt,
    memoryWrites: [],
    mode: 'supabase-edge-function',
    model: aiChatConfig.model,
    nextActions: [],
    order: result.order,
    promptVersion: {
      id: 'pmpt_6a29c7e353b88196a6e648b24c54849e0f6204e24d65c021',
      versionKey: 'platform-default',
    },
    ragMatches: [],
    requestId: undefined,
    routerMeta: undefined,
    searchSources: [],
    sessionId: result.session_id,
    responseRole: action?.type === 'order_form_submit' || action?.type === 'payment_done' ? 'system_notice' : 'assistant',
    cards: result.cards,
    text,
    uiCards,
  };
}

export async function requestPaymentSlipUpload({
  contentType,
  orderId,
  sessionId,
}: {
  contentType: 'image/jpeg' | 'image/png';
  orderId: string;
  sessionId?: string | null;
}) {
  return invokeFunction<ChatOrchestratorRequest, ChatSlipUploadResponse>('chat-orchestrator', {
    action: {
      content_type: contentType,
      order_id: orderId,
      type: 'request_slip_upload',
    },
    channel: 'app',
    client_msg_id: crypto.randomUUID(),
    message: '',
    ref_code: readStoredReferralCode() ?? undefined,
    session_id: sessionId ?? orchestratorSessionId,
    tenant_slug: defaultTenantSlug,
  });
}

export async function uploadPaymentSlipFile(uploadUrl: string, file: SlipUploadFile) {
  const body = new FormData();

  body.append('cacheControl', '600');
  body.append('', file);

  const response = await fetch(uploadUrl, {
    body,
    headers: {
      'x-upsert': 'false',
    },
    method: 'PUT',
  });

  if (!response.ok) {
    throw new Error(`Slip upload failed with ${response.status}.`);
  }
}

export async function createStripeCheckoutSession({
  orderId,
  sessionId,
}: {
  orderId: string;
  sessionId?: string | null;
}) {
  return invokeFunction<StripeCheckoutRequest, StripeCheckoutResponse>('stripe-checkout', {
    order_id: orderId,
    session_id: sessionId ?? orchestratorSessionId,
    tenant_slug: defaultTenantSlug,
  });
}

async function callProxy({
  messages,
  question,
}: {
  messages: ChatMessage[];
  question: string;
}): Promise<AskAiResult> {
  const startedAt = Date.now();
  const payload = {
    clientRequestId: `client-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    messages: messages.slice(-6).map(({ role, content }) => ({ role, content })),
    model: aiChatConfig.model,
    question,
    userNickname: DEFAULT_USER_NICKNAME,
  };

  const response = await fetch(aiChatConfig.proxyUrl!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? 'AI proxy request failed.');
  }

  const text = String(data.text ?? data.answer ?? '').trim();

  if (!text) {
    throw new Error('AI proxy returned an empty response.');
  }

  return {
    contextAssessment: parseContextAssessment(data?.contextAssessment),
    finishReason: typeof data?.finishReason === 'string' ? data.finishReason : undefined,
    intent: parseIntent(data?.intent),
    latencyMs: Date.now() - startedAt,
    memoryWrites: parseMemoryWrites(data?.memoryWrites),
    mode: 'external-proxy',
    model: String(data?.model ?? aiChatConfig.model),
    nextActions: parseNextActions(data?.nextActions),
    order: undefined,
    promptVersion: parsePromptVersion(data?.promptVersion),
    ragMatches: parseChatSources(data?.ragMatches),
    requestId: typeof data?.requestId === 'string' ? data.requestId : undefined,
    routerMeta: parseRouterMeta(data?.routerMeta),
    searchSources: parseSearchSources(data?.searchSources),
    cards: [],
    text,
    uiCards: parseUiCards(data?.uiCards),
  };
}

async function rowsToChatMessages(rows: ChatMessageRow[]): Promise<ChatMessage[]> {
  const catalogKeys = Array.from(
    new Set(
      rows.flatMap((row) => (Array.isArray(row.marker_product_ids) ? row.marker_product_ids : [])),
    ),
  );
  const products = await loadProductsByCatalogKeys(catalogKeys);
  const productByKey = new Map(products.map((product) => [product.catalog_key, product]));

  return rows.map((row) => {
    const rowProducts = (Array.isArray(row.marker_product_ids) ? row.marker_product_ids : [])
      .map((key) => productByKey.get(key))
      .filter((product): product is ProductSummary => Boolean(product))
      .map(productSummaryToChatProduct);
    const legacyUiCards = productsToUiCards(rowProducts);

    return {
      content: row.content,
      createdAt: row.created_at,
      cards: Array.isArray(row.cards) ? row.cards : [],
      id: row.id,
      role: row.role,
      uiCards: row.role !== 'user' ? apiCardsToUiCards(row.cards, legacyUiCards) : [],
    };
  });
}

async function loadProductsByCatalogKeys(catalogKeys: string[]) {
  if (catalogKeys.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('products')
    .select('id,tenant_id,catalog_key,name,description,price_baht,category,image_url,branch_info,requires_appointment,active')
    .in('catalog_key', catalogKeys);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ProductSummary[];
}

function productSummaryToChatProduct(row: ProductSummary): ChatProduct {
  return {
    catalog_key: row.catalog_key,
    category: row.category,
    description: row.description,
    image_url: row.image_url,
    name: row.name,
    price_baht: row.price_baht,
  };
}

function apiProductGridToUiCard(card: Extract<ChatCard, { type: 'product_grid' }>): ChatUiCard | null {
  if (card.products.length === 0) {
    return null;
  }

  return {
    id: `products-${card.products.map((product) => product.catalog_key).join('-')}`,
    products: card.products.map((product) => ({
      category: product.category ?? card.category ?? 'catalog',
      description: product.description,
      hospitalName: defaultTenantSlug,
      id: product.catalog_key,
      includes: [],
      priceAmount: product.price_baht,
      productImagePreviewUri: product.image_url,
      ragChunkId: null,
      tags: [card.source === 'recommendation' ? 'Recommended' : 'Catalog'],
      title: product.name,
    })),
    title: card.source === 'recommendation' ? 'Recommended products' : 'Products',
    type: 'product_grid',
  };
}

function apiCategoryGridToUiCard(card: Extract<ChatCard, { type: 'category_grid' }>): ChatUiCard | null {
  if (card.categories.length === 0) {
    return null;
  }

  return {
    categories: card.categories,
    id: `categories-${card.categories.map((category) => category.key).join('-')}`,
    title: 'หมวดสินค้า',
    type: 'category_grid',
  };
}

function apiOrderStatusToUiCard(card: Extract<ChatCard, { type: 'order_status' }>): ChatUiCard {
  return {
    id: `orders-${card.orders.map((order) => order.id).join('-') || 'empty'}`,
    orders: card.orders,
    title: 'สถานะคิว',
    type: 'order_status',
  };
}

function apiCardsToUiCards(cards: ChatCard[] | null | undefined, fallback: ChatUiCard[] = []): ChatUiCard[] {
  if (!Array.isArray(cards) || cards.length === 0) {
    return fallback;
  }

  const uiCards = cards
    .map((card): ChatUiCard | null => {
      if (card.type === 'product_grid') {
        return apiProductGridToUiCard(card);
      }

      if (card.type === 'category_grid') {
        return apiCategoryGridToUiCard(card);
      }

      if (card.type === 'order_status') {
        return apiOrderStatusToUiCard(card);
      }

      return null;
    })
    .filter((card): card is ChatUiCard => Boolean(card));

  return uiCards.length > 0 ? uiCards : fallback;
}

function productsToUiCards(products: ChatProduct[]): ChatUiCard[] {
  if (products.length === 0) {
    return [];
  }

  return [
    {
      id: `products-${products.map((product) => product.catalog_key).join('-')}`,
      products: products.map((product) => ({
        category: product.category ?? 'catalog',
        description: product.description,
        hospitalName: defaultTenantSlug,
        id: product.catalog_key,
        includes: [],
        priceAmount: product.price_baht,
        productImagePreviewUri: product.image_url,
        ragChunkId: null,
        tags: ['Catalog'],
        title: product.name,
      })),
      title: 'Recommended products',
      type: 'product_grid',
    },
  ];
}

function parseIntent(value: unknown): HealthChatIntent | undefined {
  const allowed: HealthChatIntent[] = [
    'booking',
    'checkout',
    'health_advice',
    'off_topic',
    'product_compare',
    'product_recommendation',
    'safety_escalation',
    'small_talk',
  ];

  return typeof value === 'string' && allowed.includes(value as HealthChatIntent) ? (value as HealthChatIntent) : undefined;
}

function parseContextAssessment(value: unknown): ChatContextAssessment | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const level = candidate.level;
  const mode = candidate.mode;
  const score = typeof candidate.score === 'number' ? Math.max(0, Math.min(100, candidate.score)) : undefined;

  if (
    score === undefined ||
    (level !== 'insufficient' && level !== 'partial' && level !== 'ready') ||
    (mode !== 'ask_context' && mode !== 'direct_product' && mode !== 'personalized_recommendation')
  ) {
    return undefined;
  }

  const toStringList = (input: unknown) => (Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []);

  return {
    collectedSlots: toStringList(candidate.collectedSlots),
    confidence: typeof candidate.confidence === 'number' ? Math.max(0, Math.min(1, candidate.confidence)) : 0.7,
    level,
    missingSlots: toStringList(candidate.missingSlots),
    mode,
    nextQuestion: typeof candidate.nextQuestion === 'string' ? candidate.nextQuestion : null,
    purpose: 'health_package_recommendation',
    score,
  };
}

function parsePromptVersion(value: unknown): PromptVersionInfo | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id : '';
  const versionKey = typeof candidate.versionKey === 'string' ? candidate.versionKey : '';

  return id && versionKey ? { id, versionKey } : null;
}

function parseChatSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): ChatSource | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const source = item as Record<string, unknown>;
      const id = typeof source.id === 'string' ? source.id : '';
      const title = typeof source.title === 'string' ? source.title : '';
      const category = typeof source.category === 'string' ? source.category : '';
      const topic = typeof source.topic === 'string' ? source.topic : 'general';
      const summary = typeof source.summary === 'string' ? source.summary : '';

      if (!id || !title || !category) {
        return null;
      }

      return {
        category: category as ChatSource['category'],
        id,
        riskLevel: (typeof source.riskLevel === 'string' ? source.riskLevel : 'low') as ChatSource['riskLevel'],
        score: typeof source.score === 'number' ? source.score : 0,
        source: typeof source.source === 'string' ? source.source : 'RAG corpus',
        sourceUrl: typeof source.sourceUrl === 'string' ? source.sourceUrl : undefined,
        summary,
        title,
        topic,
      };
    })
    .filter((item): item is ChatSource => Boolean(item));
}

function parseSearchSources(value: unknown): ChatSearchSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): ChatSearchSource | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const source = item as Record<string, unknown>;
      const domain = typeof source.domain === 'string' ? source.domain : '';
      const title = typeof source.title === 'string' ? source.title : domain;
      const url = typeof source.url === 'string' ? source.url : '';

      if (!domain || !url) {
        return null;
      }

      return {
        domain,
        title,
        trustTier: typeof source.trustTier === 'number' ? source.trustTier : 3,
        url,
      };
    })
    .filter((item): item is ChatSearchSource => Boolean(item));
}

function parseRouterMeta(value: unknown): ChatRouterMeta | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const allowedRoutes: ChatRetrievalRoute[] = [
    'controlled_web_search',
    'emergency',
    'none',
    'personal_memory_deep',
    'policy_rag',
    'product_rag',
    'recent_chat',
  ];
  const routes = Array.isArray(candidate.routes)
    ? candidate.routes.filter((route): route is ChatRetrievalRoute => typeof route === 'string' && allowedRoutes.includes(route as ChatRetrievalRoute))
    : [];

  if (routes.length === 0) {
    return undefined;
  }

  const latency = candidate.latencyMs && typeof candidate.latencyMs === 'object' ? (candidate.latencyMs as Record<string, unknown>) : {};

  return {
    cacheHit: typeof candidate.cacheHit === 'boolean' ? candidate.cacheHit : undefined,
    latencyMs: {
      router: typeof latency.router === 'number' ? latency.router : undefined,
      total: typeof latency.total === 'number' ? latency.total : undefined,
    },
    reasons: parseStringRecord(candidate.reasons),
    routes,
    routesRejected: parseStringRecord(candidate.routesRejected),
    stage: candidate.stage === 'heuristic' || candidate.stage === 'llm' ? candidate.stage : undefined,
  };
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string');

  return entries.length ? Object.fromEntries(entries) : undefined;
}

export async function askAiWithRag({
  action,
  messages,
  question,
  sessionId,
}: {
  action?: ChatAction | null;
  messages: ChatMessage[];
  question: string;
  sessionId?: string | null;
}) {
  if (hasSupabaseProxy) {
    return callSupabaseOrchestrator({ action, question, sessionId });
  }

  if (hasExternalProxy) {
    return callProxy({ messages, question });
  }

  throw new Error('Missing AI proxy. Configure Supabase or EXPO_PUBLIC_AI_PROXY_URL.');
}

function parseUiCards(value: unknown): ChatUiCard[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is ChatUiCard => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const candidate = item as Record<string, unknown>;
    return (
      candidate.type === 'product_grid' ||
      candidate.type === 'category_grid' ||
      candidate.type === 'order_status' ||
      candidate.type === 'branch_location' ||
      candidate.type === 'checkout_draft' ||
      candidate.type === 'memory_saved'
    );
  });
}

function parseMemoryWrites(value: unknown): ChatMemoryWrite[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is ChatMemoryWrite => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const candidate = item as Record<string, unknown>;
    return typeof candidate.summary === 'string' && typeof candidate.memoryType === 'string';
  });
}

function parseNextActions(value: unknown): ChatNextAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is ChatNextAction => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const candidate = item as Record<string, unknown>;
    return typeof candidate.label === 'string' && typeof candidate.type === 'string';
  });
}

export function createSmallTalkAnswer(question: string, userNickname = DEFAULT_USER_NICKNAME) {
  const normalized = question
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const userDisplayName = formatUserDisplayName(userNickname);

  const greetings = new Set([
    'hi',
    'hello',
    'hey',
    'sawasdee',
    'สวัสดี',
    'สวัสดีค่ะ',
    'สวัสดีครับ',
    'หวัดดี',
    'หวัดดีค่ะ',
    'หวัดดีครับ',
    'ดีค่ะ',
    'ดีครับ',
  ]);

  if (greetings.has(normalized)) {
    return `สวัสดีค่ะ${userDisplayName} วันนี้อยากให้ฉันช่วยเรื่องอะไรคะ`;
  }

  if (['ขอบคุณ', 'ขอบคุณค่ะ', 'ขอบคุณครับ', 'thanks', 'thank you'].includes(normalized)) {
    return `ยินดีค่ะ${userDisplayName}`;
  }

  return null;
}

export function createOfflineRagAnswer(question: string, ragMatches: RagMatch[]) {
  const smallTalkAnswer = createSmallTalkAnswer(question);

  if (smallTalkAnswer) {
    return smallTalkAnswer;
  }

  return createNaturalHealthFallbackAnswer(question, { hasMatches: ragMatches.length > 0, userNickname: DEFAULT_USER_NICKNAME });
}
