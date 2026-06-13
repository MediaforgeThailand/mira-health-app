import { HttpError } from './http.ts';
import type { ChatAction, ChatCategory, ChatProduct, OrderPanelState } from './types.ts';

declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
};

export type LineTextMessage = {
  text: string;
  type: 'text';
};

export type LineFlexMessage = {
  altText: string;
  contents: Record<string, unknown>;
  type: 'flex';
};

export type LineImageMessage = {
  originalContentUrl: string;
  previewImageUrl: string;
  type: 'image';
};

export type LineMessage = LineFlexMessage | LineImageMessage | LineTextMessage;

type NonNullOrderPanelState = Exclude<OrderPanelState, null>;

const BOOK_LABEL = '\u0e08\u0e2d\u0e07';
const CUSTOMER_PAID_LABEL = '\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32\u0e08\u0e48\u0e32\u0e22\u0e41\u0e25\u0e49\u0e27';
const GREETING_MESSAGE = '\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35';
const PACKAGE_DETAILS_FALLBACK =
  '\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14\u0e41\u0e1e\u0e47\u0e01\u0e40\u0e01\u0e08';
const RECOMMENDED_PACKAGES_ALT =
  '\u0e41\u0e1e\u0e47\u0e01\u0e40\u0e01\u0e08\u0e17\u0e35\u0e48\u0e41\u0e19\u0e30\u0e19\u0e33';
const SELECT_PRODUCT_MESSAGE =
  '\u0e15\u0e49\u0e2d\u0e07\u0e01\u0e32\u0e23\u0e08\u0e2d\u0e07\u0e41\u0e1e\u0e47\u0e01\u0e40\u0e01\u0e08\u0e19\u0e35\u0e49';
// "\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2a\u0e32\u0e02\u0e32\u0e19\u0e35\u0e49" (choose this branch)
const SELECT_BRANCH_LABEL = '\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2a\u0e32\u0e02\u0e32\u0e19\u0e35\u0e49';
// "\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2a\u0e32\u0e02\u0e32" (choose a branch)
const SELECT_BRANCH_ALT = '\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2a\u0e32\u0e02\u0e32';
// "\u0e14\u0e39\u0e41\u0e1e\u0e47\u0e01\u0e40\u0e01\u0e08" (view packages)
const CATEGORY_VIEW_LABEL = '\u0e14\u0e39\u0e41\u0e1e\u0e47\u0e01\u0e40\u0e01\u0e08';
// "\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2b\u0e21\u0e27\u0e14\u0e17\u0e35\u0e48\u0e2a\u0e19\u0e43\u0e08" (choose a category)
const CATEGORY_LIST_ALT = '\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2b\u0e21\u0e27\u0e14\u0e17\u0e35\u0e48\u0e2a\u0e19\u0e43\u0e08';
// "\u0e02\u0e2d\u0e14\u0e39\u0e41\u0e1e\u0e47\u0e01\u0e40\u0e01\u0e08\u0e43\u0e19\u0e2b\u0e21\u0e27\u0e14\u0e19\u0e35\u0e49" (browse this category)
const BROWSE_CATEGORY_MESSAGE = '\u0e02\u0e2d\u0e14\u0e39\u0e41\u0e1e\u0e47\u0e01\u0e40\u0e01\u0e08\u0e43\u0e19\u0e2b\u0e21\u0e27\u0e14\u0e19\u0e35\u0e49';
// "\u0e41\u0e1e\u0e47\u0e01\u0e40\u0e01\u0e08" (packages, unit suffix)
const PACKAGE_UNIT_LABEL = '\u0e41\u0e1e\u0e47\u0e01\u0e40\u0e01\u0e08';
// "\u0e01\u0e23\u0e2d\u0e01\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e1c\u0e39\u0e49\u0e23\u0e31\u0e1a\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23" (fill in the recipient's details)
const ORDER_FORM_BUTTON_LABEL = '\u0e01\u0e23\u0e2d\u0e01\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e1c\u0e39\u0e49\u0e23\u0e31\u0e1a\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23';
// "\u0e01\u0e14\u0e1b\u0e38\u0e48\u0e21\u0e14\u0e49\u0e32\u0e19\u0e25\u0e48\u0e32\u0e07\u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e01\u0e23\u0e2d\u0e01\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e1c\u0e39\u0e49\u0e23\u0e31\u0e1a\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23\u0e04\u0e48\u0e30"
const ORDER_FORM_PROMPT = '\u0e01\u0e14\u0e1b\u0e38\u0e48\u0e21\u0e14\u0e49\u0e32\u0e19\u0e25\u0e48\u0e32\u0e07\u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e01\u0e23\u0e2d\u0e01\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e1c\u0e39\u0e49\u0e23\u0e31\u0e1a\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23\u0e04\u0e48\u0e30';
const ORDER_FORM_ALT = '\u0e01\u0e23\u0e2d\u0e01\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e1c\u0e39\u0e49\u0e23\u0e31\u0e1a\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23';

function requireEnv(key: string) {
  const value = Deno.env.get(key)?.trim();

  if (!value) {
    throw new HttpError('UPSTREAM', `Missing ${key}.`, 500);
  }

  return value;
}

function getTenantEnv(baseKey: string, tenantSlug: string) {
  const directKey = `${baseKey}__${tenantSlug}`;
  const underscoreKey = `${baseKey}__${tenantSlug.replace(/-/g, '_')}`;

  return Deno.env.get(directKey)?.trim() || Deno.env.get(underscoreKey)?.trim();
}

export function requireTenantEnv(baseKey: string, tenantSlug: string) {
  return getTenantEnv(baseKey, tenantSlug) || requireEnv(baseKey);
}

// Builds the LIFF URL that opens the buyer-info form, or null when no LIFF app is
// configured for the tenant yet (the caller then simply omits the form button).
export function lineFormUrl(tenantSlug: string, orderId: string): string | null {
  const liffId = getTenantEnv('LINE_LIFF_ID', tenantSlug) || Deno.env.get('LINE_LIFF_ID')?.trim();

  if (!liffId) {
    return null;
  }

  return `https://liff.line.me/${liffId}?order=${encodeURIComponent(orderId)}`;
}

export function requireLineChannelToken(tenantSlug: string) {
  const token =
    getTenantEnv('LINE_CHANNEL_TOKEN', tenantSlug) ||
    getTenantEnv('LINE_CHANNEL_ACCESS_TOKEN', tenantSlug) ||
    Deno.env.get('LINE_CHANNEL_TOKEN')?.trim() ||
    Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')?.trim();

  if (!token) {
    throw new HttpError('UPSTREAM', 'Missing LINE_CHANNEL_TOKEN.', 500);
  }

  return token;
}

function base64ToBytes(value: string) {
  let binary: string;

  try {
    binary = atob(value);
  } catch {
    throw new HttpError('VALIDATION', 'Invalid LINE signature.', 401);
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export async function verifyLineSignature(body: string, signature: string | null, tenantSlug: string) {
  const secret = requireTenantEnv('LINE_CHANNEL_SECRET', tenantSlug);

  if (!signature) {
    throw new HttpError('VALIDATION', 'Missing LINE signature.', 401);
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      hash: 'SHA-256',
      name: 'HMAC',
    },
    false,
    ['verify'],
  );
  const bodyBytes = new TextEncoder().encode(body);
  const signatureBytes = base64ToBytes(signature);
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, bodyBytes);

  if (!valid) {
    throw new HttpError('VALIDATION', 'Invalid LINE signature.', 401);
  }
}

export async function replyLineMessages(replyToken: string, messages: LineMessage[], tenantSlug: string) {
  const token = requireLineChannelToken(tenantSlug);
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    body: JSON.stringify({
      messages,
      replyToken,
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new HttpError('UPSTREAM', `LINE reply failed with ${response.status}.`, 502);
  }
}

export async function pushLineMessages(tenantSlug: string, lineUserId: string, messages: LineMessage[]) {
  const token = requireLineChannelToken(tenantSlug);
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    body: JSON.stringify({
      messages,
      to: lineUserId,
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new HttpError('UPSTREAM', `LINE push failed with ${response.status}.`, 502);
  }
}

export function textLineMessage(text: string): LineTextMessage {
  return {
    text: text.slice(0, 4500),
    type: 'text',
  };
}

export function linePostbackToAction(data: string | undefined): { action: ChatAction | null; message: string } {
  if (!data) {
    return {
      action: null,
      message: GREETING_MESSAGE,
    };
  }

  if (data.startsWith('select_product:')) {
    return {
      action: {
        catalog_key: data.replace('select_product:', ''),
        type: 'select_product',
      },
      message: SELECT_PRODUCT_MESSAGE,
    };
  }

  if (data.startsWith('payment_done:')) {
    return {
      action: {
        order_id: data.replace('payment_done:', ''),
        type: 'payment_done',
      },
      message: CUSTOMER_PAID_LABEL,
    };
  }

  if (data.startsWith('select_branch:')) {
    const rest = data.slice('select_branch:'.length);
    const separator = rest.indexOf(':');

    if (separator > 0) {
      const orderId = rest.slice(0, separator);
      const branchId = rest.slice(separator + 1);

      if (orderId && branchId) {
        return {
          action: {
            branch_id: branchId,
            order_id: orderId,
            type: 'select_branch',
          },
          message: SELECT_BRANCH_LABEL,
        };
      }
    }
  }

  if (data.startsWith('browse_category:')) {
    const category = data.slice('browse_category:'.length).trim();

    if (category) {
      return {
        action: {
          category,
          type: 'browse_category',
        },
        message: BROWSE_CATEGORY_MESSAGE,
      };
    }
  }

  return {
    action: null,
    message: data.slice(0, 400) || GREETING_MESSAGE,
  };
}

export function productLineFlexMessage(products: ChatProduct[]): LineFlexMessage | null {
  if (products.length === 0) {
    return null;
  }

  return {
    altText: RECOMMENDED_PACKAGES_ALT,
    contents: {
      contents: products.slice(0, 10).map((product) => ({
        body: {
          contents: [
            {
              size: 'md',
              text: product.name,
              type: 'text',
              weight: 'bold',
              wrap: true,
            },
            {
              color: '#4E5F59',
              margin: 'sm',
              size: 'sm',
              text: product.description || PACKAGE_DETAILS_FALLBACK,
              type: 'text',
              wrap: true,
            },
            {
              color: '#163F34',
              margin: 'md',
              size: 'sm',
              text: `${product.price_baht.toLocaleString('th-TH')} THB`,
              type: 'text',
              weight: 'bold',
            },
          ],
          layout: 'vertical',
          type: 'box',
        },
        footer: {
          contents: [
            {
              action: {
                data: `select_product:${product.catalog_key}`,
                label: BOOK_LABEL,
                type: 'postback',
              },
              color: '#163F34',
              style: 'primary',
              type: 'button',
            },
          ],
          layout: 'vertical',
          type: 'box',
        },
        hero: product.image_url
          ? {
              aspectMode: 'cover',
              aspectRatio: '20:13',
              size: 'full',
              type: 'image',
              url: product.image_url,
            }
          : undefined,
        type: 'bubble',
      })),
      type: 'carousel',
    },
    type: 'flex',
  };
}

export function orderFormLineFlexMessage(formUrl: string, productName: string): LineFlexMessage {
  return {
    altText: ORDER_FORM_ALT,
    contents: {
      body: {
        contents: [
          {
            size: 'md',
            text: productName,
            type: 'text',
            weight: 'bold',
            wrap: true,
          },
          {
            color: '#4E5F59',
            margin: 'sm',
            size: 'sm',
            text: ORDER_FORM_PROMPT,
            type: 'text',
            wrap: true,
          },
        ],
        layout: 'vertical',
        type: 'box',
      },
      footer: {
        contents: [
          {
            action: {
              label: ORDER_FORM_BUTTON_LABEL,
              type: 'uri',
              uri: formUrl,
            },
            color: '#163F34',
            style: 'primary',
            type: 'button',
          },
        ],
        layout: 'vertical',
        type: 'box',
      },
      type: 'bubble',
    },
    type: 'flex',
  };
}

export function categoryLineFlexMessage(categories: ChatCategory[]): LineFlexMessage | null {
  if (categories.length === 0) {
    return null;
  }

  return {
    altText: CATEGORY_LIST_ALT,
    contents: {
      contents: categories.slice(0, 10).map((category) => ({
        body: {
          contents: [
            {
              size: 'md',
              text: category.icon ? `${category.icon} ${category.label_th}` : category.label_th,
              type: 'text',
              weight: 'bold',
              wrap: true,
            },
            {
              color: '#4E5F59',
              margin: 'sm',
              size: 'sm',
              text: `${category.product_count} ${PACKAGE_UNIT_LABEL}`,
              type: 'text',
            },
          ],
          layout: 'vertical',
          type: 'box',
        },
        footer: {
          contents: [
            {
              action: {
                data: `browse_category:${category.key}`,
                label: CATEGORY_VIEW_LABEL,
                type: 'postback',
              },
              color: '#163F34',
              style: 'primary',
              type: 'button',
            },
          ],
          layout: 'vertical',
          type: 'box',
        },
        type: 'bubble',
      })),
      type: 'carousel',
    },
    type: 'flex',
  };
}

export function branchSelectionLineFlexMessage(order: NonNullOrderPanelState): LineFlexMessage | null {
  const branches = order.branches ?? [];

  if (branches.length === 0) {
    return null;
  }

  return {
    altText: SELECT_BRANCH_ALT,
    contents: {
      contents: branches.slice(0, 10).map((branch) => {
        const location = branch.district || branch.address || null;

        return {
          body: {
            contents: [
              {
                size: 'md',
                text: branch.name,
                type: 'text',
                weight: 'bold',
                wrap: true,
              },
              ...(location
                ? [
                    {
                      color: '#4E5F59',
                      margin: 'sm',
                      size: 'sm',
                      text: location,
                      type: 'text',
                      wrap: true,
                    },
                  ]
                : []),
            ],
            layout: 'vertical',
            type: 'box',
          },
          footer: {
            contents: [
              {
                action: {
                  data: `select_branch:${order.id}:${branch.id}`,
                  label: SELECT_BRANCH_LABEL,
                  type: 'postback',
                },
                color: '#163F34',
                style: 'primary',
                type: 'button',
              },
            ],
            layout: 'vertical',
            type: 'box',
          },
          type: 'bubble',
        };
      }),
      type: 'carousel',
    },
    type: 'flex',
  };
}

export function orderQrLineImageMessage(qrUrl: string): LineImageMessage {
  return {
    originalContentUrl: qrUrl,
    previewImageUrl: qrUrl,
    type: 'image',
  };
}

export function orderPaymentLineFlexMessage(order: NonNullOrderPanelState): LineFlexMessage {
  return {
    altText: 'PromptPay QR',
    contents: {
      body: {
        contents: [
          {
            size: 'md',
            text: order.product_name,
            type: 'text',
            weight: 'bold',
            wrap: true,
          },
          {
            color: '#163F34',
            margin: 'sm',
            size: 'sm',
            text: `${order.amount_baht.toLocaleString('th-TH')} THB`,
            type: 'text',
            weight: 'bold',
          },
        ],
        layout: 'vertical',
        type: 'box',
      },
      footer: {
        contents: [
          {
            action: {
              data: `payment_done:${order.id}`,
              label: CUSTOMER_PAID_LABEL,
              type: 'postback',
            },
            color: '#163F34',
            style: 'primary',
            type: 'button',
          },
        ],
        layout: 'vertical',
        type: 'box',
      },
      type: 'bubble',
    },
    type: 'flex',
  };
}
