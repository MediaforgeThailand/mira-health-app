import type { HospitalProduct } from '@/lib/marketplace/hospitalProducts';
import type { ChatCategory, OrderStatusInfo } from '@/lib/types/api';

export type HealthChatIntent =
  | 'booking'
  | 'checkout'
  | 'health_advice'
  | 'off_topic'
  | 'product_compare'
  | 'product_recommendation'
  | 'safety_escalation'
  | 'small_talk';

export type ChatContextLevel = 'insufficient' | 'partial' | 'ready';

export type ChatRecommendationMode = 'ask_context' | 'direct_product' | 'personalized_recommendation';

export type ChatRetrievalRoute =
  | 'controlled_web_search'
  | 'emergency'
  | 'none'
  | 'personal_memory_deep'
  | 'policy_rag'
  | 'product_rag'
  | 'recent_chat';

export type ChatRouterMeta = {
  cacheHit?: boolean;
  latencyMs?: {
    router?: number;
    total?: number;
  };
  reasons?: Record<string, string>;
  routes: ChatRetrievalRoute[];
  routesRejected?: Record<string, string>;
  stage?: 'heuristic' | 'llm';
};

export type ChatSearchSource = {
  domain: string;
  title: string;
  trustTier: number;
  url: string;
};

export type ChatContextAssessment = {
  collectedSlots: string[];
  confidence: number;
  level: ChatContextLevel;
  missingSlots: string[];
  mode: ChatRecommendationMode;
  nextQuestion?: string | null;
  purpose: 'health_package_recommendation';
  score: number;
};

export type ChatMemoryType =
  | 'budget'
  | 'communication_preference'
  | 'goal'
  | 'lifestyle_preference'
  | 'location_preference'
  | 'other'
  | 'product_interest';

export type ChatProductCard = {
  bookingNote?: string | null;
  category: string;
  description: string;
  duration?: string | null;
  hospitalAddress?: string | null;
  hospitalLat?: number | null;
  hospitalLng?: number | null;
  hospitalMapQuery?: string | null;
  hospitalName: string;
  id: string;
  includes: string[];
  priceAmount: number;
  productImagePreviewUri?: string | null;
  ragChunkId?: string | null;
  reason?: string;
  tags: string[];
  title: string;
};

export type ChatBranchCard = {
  address?: string | null;
  distanceLabel?: string;
  hospitalName: string;
  id: string;
  lat?: number | null;
  lng?: number | null;
  mapQuery?: string | null;
  name: string;
  nextSlot?: string;
  productId: string;
};

export type ChatUiCard =
  | {
      id: string;
      products: ChatProductCard[];
      title: string;
      type: 'product_grid';
    }
  | {
      categories: ChatCategory[];
      id: string;
      title: string;
      type: 'category_grid';
    }
  | {
      id: string;
      orders: OrderStatusInfo[];
      title: string;
      type: 'order_status';
    }
  | {
      branches: ChatBranchCard[];
      id: string;
      product: ChatProductCard;
      title: string;
      type: 'branch_location';
    }
  | {
      branch?: ChatBranchCard;
      id: string;
      product: ChatProductCard;
      title: string;
      type: 'checkout_draft';
    }
  | {
      count: number;
      id: string;
      summaries: string[];
      type: 'memory_saved';
    };

export type ChatMemoryWrite = {
  confidence: number;
  id?: string;
  memoryType: ChatMemoryType;
  status: 'saved' | 'skipped';
  summary: string;
  validUntil?: string | null;
  value?: string | null;
};

export type ChatNextAction =
  | {
      label: string;
      type: 'open_checkout';
      url: string;
    }
  | {
      label: string;
      payload?: Record<string, unknown>;
      type: 'show_products' | 'show_locations';
    };

export function toChatProductCard(product: HospitalProduct, reason?: string): ChatProductCard {
  return {
    bookingNote: product.bookingNote,
    category: product.category,
    description: product.description,
    duration: product.duration,
    hospitalAddress: product.hospitalAddress ?? product.location,
    hospitalLat: product.hospitalLat,
    hospitalLng: product.hospitalLng,
    hospitalMapQuery: product.hospitalMapQuery,
    hospitalName: product.hospitalName,
    id: product.id,
    includes: product.includes,
    priceAmount: product.priceAmount,
    productImagePreviewUri: product.productImagePreviewUri,
    ragChunkId: product.ragChunkId,
    reason,
    tags: product.tags,
    title: product.title,
  };
}

export function createProductBranch(product: ChatProductCard): ChatBranchCard {
  return {
    address: product.hospitalAddress,
    distanceLabel: product.hospitalLat && product.hospitalLng ? 'Map ready' : 'Confirm distance',
    hospitalName: product.hospitalName,
    id: `branch-${product.id}`,
    lat: product.hospitalLat,
    lng: product.hospitalLng,
    mapQuery: product.hospitalMapQuery ?? product.hospitalName,
    name: product.hospitalName,
    nextSlot: product.bookingNote ? 'Confirm by call center' : 'Next available',
    productId: product.id,
  };
}
