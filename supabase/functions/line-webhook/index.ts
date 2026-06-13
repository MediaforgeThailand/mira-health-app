import QRCode from 'qrcode';

import { HttpError, handleOptions, json, toErrorResponse } from '../_shared/http.ts';
import {
  branchSelectionLineFlexMessage,
  categoryLineFlexMessage,
  lineFormUrl,
  linePostbackToAction,
  orderFormLineFlexMessage,
  orderPaymentLineFlexMessage,
  orderQrLineImageMessage,
  productLineFlexMessage,
  replyLineMessages,
  textLineMessage,
  verifyLineSignature,
  type LineMessage,
} from '../_shared/line.ts';
import { orchestrateLine } from '../_shared/orchestrate.ts';
import { uploadStorageObject } from '../_shared/storage.ts';
import type { ChatOrchestratorResponse, OrderPanelState } from '../_shared/types.ts';

declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

type LineEvent = {
  deliveryContext?: {
    isRedelivery?: boolean;
  };
  message?: {
    id?: string;
    text?: string;
    type?: string;
  };
  postback?: {
    data?: string;
  };
  replyToken?: string;
  source?: {
    userId?: string;
  };
  type?: string;
};

type LineWebhookBody = {
  events?: LineEvent[];
};

function envOrDefault(key: string, fallback: string) {
  return Deno.env.get(key)?.trim() || fallback;
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function orderLineMessages(order: NonNullable<OrderPanelState>): Promise<LineMessage[]> {
  if (!order.qr_payload) {
    return [];
  }

  const dataUrl = await QRCode.toDataURL(order.qr_payload, {
    margin: 1,
    scale: 8,
    type: 'image/png',
  });
  const qrBytes = base64ToBytes(dataUrl.split(',')[1] ?? '');
  const qrUrl = await uploadStorageObject('line-assets', `promptpay/${order.id}.png`, qrBytes, 'image/png');

  return [
    orderQrLineImageMessage(qrUrl),
    orderPaymentLineFlexMessage(order),
  ];
}

async function toLineMessages(response: ChatOrchestratorResponse, tenantSlug: string) {
  const messages: LineMessage[] = [textLineMessage(response.text)];
  const products = productLineFlexMessage(response.products);

  if (products) {
    messages.push(products);
  }

  const order = response.order;

  if (order) {
    if (order.step === 'branch') {
      const branchMessage = branchSelectionLineFlexMessage(order);

      if (branchMessage) {
        messages.push(branchMessage);
      }
    } else if (order.step === 'form') {
      const formUrl = lineFormUrl(tenantSlug, order.id);

      if (formUrl) {
        messages.push(orderFormLineFlexMessage(formUrl, order.product_name));
      }
    } else {
      messages.push(...await orderLineMessages(order));
    }
  }

  for (const card of response.cards) {
    if (card.type === 'category_grid') {
      const categories = categoryLineFlexMessage(card.categories);

      if (categories) {
        messages.push(categories);
      }
    }
  }

  return messages.slice(0, 5);
}

async function handleEvent(event: LineEvent, tenantSlug: string) {
  // Idempotency (V3-5): LINE re-delivers events when the webhook is slow to ack.
  // Reprocessing a redelivered postback creates duplicate orders, so skip them.
  if (event.deliveryContext?.isRedelivery) {
    return;
  }

  const replyToken = event.replyToken;
  const lineUserId = event.source?.userId;

  if (!replyToken || !lineUserId) {
    return;
  }

  if (event.type === 'message' && event.message?.type === 'text' && event.message.text) {
    const response = await orchestrateLine({
      action: null,
      client_msg_id: event.message.id ?? crypto.randomUUID(),
      line_user_id: lineUserId,
      message: event.message.text,
      tenant_slug: tenantSlug,
    });

    await replyLineMessages(replyToken, await toLineMessages(response, tenantSlug), tenantSlug);
    return;
  }

  if (event.type === 'postback') {
    const parsed = linePostbackToAction(event.postback?.data);
    const response = await orchestrateLine({
      action: parsed.action,
      client_msg_id: crypto.randomUUID(),
      line_user_id: lineUserId,
      message: parsed.message,
      tenant_slug: tenantSlug,
    });

    await replyLineMessages(replyToken, await toLineMessages(response, tenantSlug), tenantSlug);
    return;
  }

  if (event.type === 'follow') {
    const response = await orchestrateLine({
      action: null,
      client_msg_id: crypto.randomUUID(),
      line_user_id: lineUserId,
      message: 'สวัสดี',
      tenant_slug: tenantSlug,
    });

    await replyLineMessages(replyToken, await toLineMessages(response, tenantSlug), tenantSlug);
  }
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);

  if (optionsResponse) {
    return optionsResponse;
  }

  if (req.method !== 'POST') {
    return toErrorResponse(new HttpError('VALIDATION', 'Method not allowed.', 405));
  }

  try {
    const bodyText = await req.text();
    const tenantSlug = new URL(req.url).searchParams.get('tenant') ?? envOrDefault('MIRA_DEFAULT_TENANT_SLUG', 'demo-hospital');
    await verifyLineSignature(bodyText, req.headers.get('x-line-signature'), tenantSlug);
    const payload = JSON.parse(bodyText) as LineWebhookBody;

    for (const event of payload.events ?? []) {
      await handleEvent(event, tenantSlug);
    }

    return json({
      ok: true,
      processed: payload.events?.length ?? 0,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
