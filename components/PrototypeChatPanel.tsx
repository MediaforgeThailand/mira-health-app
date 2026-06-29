import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import {
  aiChatConfigStatus,
  askAiWithRag,
  checkStripePromptPayQrStatus,
  createStripePromptPayQr,
  getCurrentChatSessionId,
  loadLatestChatHistoryPage,
  refreshActiveOrderPanel,
  type ChatMessage,
} from '@/lib/ai/miraChat';
import { useAuthSession, useSignOut } from '@/lib/auth/useAuthSession';
import type { ChatAction, OrderPanelState, StripePromptPayQrResponse } from '@/lib/types/api';
import {
  MiraChatShell,
  type MiraChatMessage,
  type MiraOrderInfoFormSubmit,
} from './chat/MiraChatRedesign';

const VOICE_INPUT_DISABLED_MESSAGE = 'ฟีเจอร์ไมค์พักการใช้งานชั่วคราวค่ะ';

function createMessage(
  role: ChatMessage['role'],
  content: string,
  sources?: ChatMessage['sources'],
  uiCards?: ChatMessage['uiCards'],
  order?: OrderPanelState,
): MiraChatMessage {
  return {
    content,
    createdAt: new Date().toISOString(),
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    order,
    role,
    sources,
    uiCards,
  };
}

type SendChatTurnOptions = {
  action?: ChatAction | null;
  fallbackRole?: ChatMessage['role'];
  question: string;
  throwOnError?: boolean;
  userText?: string;
};

export function PrototypeChatPanel() {
  const auth = useAuthSession();
  const router = useRouter();
  const signOut = useSignOut();
  const searchParams = useLocalSearchParams<{ orderId?: string; payment?: string }>();
  const didRestoreChat = useRef(false);
  const announcedPaidOrderIds = useRef(new Set<string>());
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<MiraChatMessage[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);

  const canUseLiveAi = Boolean(auth.session && aiChatConfigStatus.hasSupabaseProxy);
  const brandName = process.env.EXPO_PUBLIC_MIRA_BRAND_NAME?.trim() || null;

  useEffect(() => {
    if (!canUseLiveAi || didRestoreChat.current) {
      return;
    }

    didRestoreChat.current = true;
    const payment = Array.isArray(searchParams.payment) ? searchParams.payment[0] : searchParams.payment;
    const orderId = Array.isArray(searchParams.orderId) ? searchParams.orderId[0] : searchParams.orderId;

    void (async () => {
      const restoredMessages: MiraChatMessage[] = [];

      try {
        const history = await loadLatestChatHistoryPage();
        restoredMessages.push(...history.messages);
      } catch {
        restoredMessages.push(createMessage('system_notice', 'ยังโหลดประวัติแชทล่าสุดไม่ได้ค่ะ'));
      }

      if (payment === 'stripe_success') {
        restoredMessages.push(createMessage('system_notice', 'ชำระเงินผ่าน Stripe สำเร็จแล้วค่ะ กำลังอัปเดตสถานะคำสั่งซื้อ'));
      } else if (payment === 'stripe_cancelled') {
        restoredMessages.push(createMessage('system_notice', 'ยังไม่ได้ชำระเงินค่ะ สามารถสร้าง QR Stripe เพื่อชำระอีกครั้งได้'));
      }

      if (restoredMessages.length > 0) {
        setMessages(restoredMessages);
      }

      if (payment === 'stripe_success' && orderId) {
        try {
          const refreshed = await refreshActiveOrderPanel(getCurrentChatSessionId());

          if (refreshed.order) {
            setMessages((current) => [...current, createMessage('system_notice', 'อัปเดตสถานะคำสั่งซื้อแล้วค่ะ', undefined, undefined, refreshed.order)]);
          }
        } catch (error) {
          setMessages((current) => [
            ...current,
            createMessage('system_notice', error instanceof Error ? `อัปเดต order ไม่สำเร็จ: ${error.message}` : 'อัปเดต order ไม่สำเร็จ'),
          ]);
        }
      }

      if (payment === 'stripe_success' || payment === 'stripe_cancelled') {
        router.replace('/chat' as Href);
      }
    })();
  }, [canUseLiveAi, router, searchParams.orderId, searchParams.payment]);

  function toggleVoiceRecording() {
    setVoiceStatus(VOICE_INPUT_DISABLED_MESSAGE);
  }

  function appendSystemNotice(content: string) {
    setMessages((current) => [...current, createMessage('system_notice', content)]);
  }

  function liveUnavailableMessage() {
    if (auth.isLoading) {
      return 'กำลังตรวจสอบ session สำหรับ live chat กรุณาลองอีกครั้งค่ะ';
    }

    if (!auth.session) {
      return 'ต้องเข้าสู่ระบบก่อนใช้ live AI chat ค่ะ';
    }

    if (!aiChatConfigStatus.hasSupabaseProxy) {
      return 'ยังไม่ได้ตั้งค่า Supabase live chat สำหรับหน้านี้ค่ะ';
    }

    return 'live AI chat ยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้งค่ะ';
  }

  function goToChatLogin() {
    router.push({ pathname: '/login', params: { mode: 'chat', redirect: '/chat' } });
  }

  async function handleChatAuthPress() {
    if (auth.isLoading) {
      return;
    }

    if (!auth.session) {
      goToChatLogin();
      return;
    }

    try {
      await signOut();
      didRestoreChat.current = false;
      setMessages([]);
      setVoiceStatus('ออกจากระบบแล้ว');
    } catch (error) {
      setVoiceStatus(error instanceof Error ? error.message : 'ออกจากระบบไม่สำเร็จ');
    }
  }

  async function sendChatTurn({
    action = null,
    fallbackRole = 'assistant',
    question,
    throwOnError = false,
    userText = question,
  }: SendChatTurnOptions) {
    const trimmedQuestion = question.trim();
    const trimmedUserText = userText.trim();

    if (!trimmedQuestion || !trimmedUserText || isSending) {
      return;
    }

    if (!auth.session) {
      if (auth.isLoading) {
        setVoiceStatus('กำลังตรวจสอบ session ค่ะ');
      } else {
        setVoiceStatus(null);
        goToChatLogin();
      }

      if (throwOnError) {
        throw new Error('Login required.');
      }

      return;
    }

    const userMessage = createMessage('user', trimmedUserText);
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsSending(true);
    setVoiceStatus(null);

    try {
      if (!canUseLiveAi) {
        appendSystemNotice(liveUnavailableMessage());

        if (throwOnError) {
          throw new Error('Live AI chat is unavailable.');
        }

        return;
      }

      const result = await askAiWithRag({
        action,
        messages: nextMessages,
        question: trimmedQuestion,
      });
      const answer = createMessage(result.responseRole ?? fallbackRole, result.text, result.ragMatches, result.uiCards, result.order);
      setMessages((current) => [...current, answer]);
    } catch (error) {
      const message = error instanceof Error ? `live AI chat error: ${error.message}` : 'live AI chat error';
      appendSystemNotice(message);

      if (throwOnError) {
        throw error;
      }
    } finally {
      setIsSending(false);
    }
  }

  async function sendMessage() {
    await sendChatTurn({ question: input });
  }

  async function sendQuickReply(text: string) {
    await sendChatTurn({ question: text });
  }

  async function browseCategory(category: string, label: string) {
    await sendChatTurn({
      action: {
        category,
        type: 'browse_category',
      },
      question: `ดูหมวด ${label || category}`,
    });
  }

  async function selectProduct(productId: string, productTitle: string) {
    await sendChatTurn({
      action: {
        catalog_key: productId,
        type: 'select_product',
      },
      question: `สนใจ ${productTitle || productId}`,
    });
  }

  function selectBranch(_productId: string, _branchId: string) {
    appendSystemNotice('การเลือกสาขาต้องมาจาก order step ของ backend จริงค่ะ');
  }

  function updateOrderInMessages(order: OrderPanelState) {
    if (!order) {
      return;
    }

    setMessages((current) => current.map((message) => (message.order?.id === order.id ? { ...message, order } : message)));
  }

  function announceStripePaymentIfSubmitted(response: StripePromptPayQrResponse) {
    const order = response.order;

    if (!order || !response.submitted || announcedPaidOrderIds.current.has(order.id)) {
      return;
    }

    announcedPaidOrderIds.current.add(order.id);
    setMessages((current) => [
      ...current,
      createMessage('system_notice', 'ชำระเงินผ่าน Stripe สำเร็จแล้วค่ะ รายการถูกส่งเข้า queue ให้โรงพยาบาลตรวจสอบต่อแล้ว'),
    ]);
  }

  async function submitOrderInfo({
    buyerAge,
    buyerName,
    buyerPhone,
    orderId,
    preferredDate,
    preferredDateEnd,
    preferredTimeWindow,
  }: MiraOrderInfoFormSubmit) {
    await sendChatTurn({
      action: {
        buyer_age: buyerAge,
        buyer_name: buyerName,
        buyer_phone: buyerPhone,
        order_id: orderId,
        preferred_date: preferredDate,
        preferred_date_end: preferredDateEnd,
        preferred_time_window: preferredTimeWindow,
        type: 'order_form_submit',
      },
      fallbackRole: 'system_notice',
      question: 'ส่งข้อมูลผู้จองแล้ว',
      throwOnError: true,
    });
  }

  async function createPrototypeStripeQr(orderId: string) {
    if (!canUseLiveAi) {
      appendSystemNotice(liveUnavailableMessage());
      throw new Error('Live AI chat is unavailable.');
    }

    try {
      const result = await createStripePromptPayQr({
        orderId,
        sessionId: getCurrentChatSessionId(),
      });
      updateOrderInMessages(result.order);
      announceStripePaymentIfSubmitted(result);
      return result;
    } catch (error) {
      appendSystemNotice(error instanceof Error ? `สร้าง QR Stripe ไม่สำเร็จ: ${error.message}` : 'สร้าง QR Stripe ไม่สำเร็จ');
      throw error;
    }
  }

  async function checkPrototypeStripeQrStatus(orderId: string) {
    if (!canUseLiveAi) {
      appendSystemNotice(liveUnavailableMessage());
      throw new Error('Live AI chat is unavailable.');
    }

    try {
      const result = await checkStripePromptPayQrStatus({
        orderId,
        sessionId: getCurrentChatSessionId(),
      });
      updateOrderInMessages(result.order);
      announceStripePaymentIfSubmitted(result);
      return result;
    } catch (error) {
      throw error instanceof Error ? error : new Error('ตรวจสอบสถานะ Stripe ไม่สำเร็จ');
    }
  }

  return (
    <MiraChatShell
      authLabel={auth.isLoading ? '...' : auth.session ? 'ออก' : 'เข้า'}
      brandName={brandName}
      canUseLiveAi={canUseLiveAi}
      input={input}
      isAuthLoading={auth.isLoading}
      isAuthenticated={Boolean(auth.session)}
      isSending={isSending}
      messages={messages}
      onAuthPress={() => void handleChatAuthPress()}
      onBackPress={() => router.back()}
      onBrowseCategory={(category, label) => void browseCategory(category, label)}
      onQuickReply={(text) => void sendQuickReply(text)}
      onSelectBranch={selectBranch}
      onSelectProduct={(productId, productTitle) => void selectProduct(productId, productTitle)}
      onSendMessage={() => void sendMessage()}
      onSetInput={setInput}
      onStripePromptPayQr={createPrototypeStripeQr}
      onStripePromptPayStatus={checkPrototypeStripeQrStatus}
      onSubmitOrderInfo={submitOrderInfo}
      onVoicePress={toggleVoiceRecording}
      voiceStatus={voiceStatus}
    />
  );
}
