(() => {
  const STATUS = {
    config: false,
    instance: false,
    lastSyncAt: null,
    mode: "design",
    missing: [],
    errors: [],
  };

  window.__miraBackendStatus = STATUS;
  let bootSignature = "";
  let bootPromise = null;

  function noteMissing(message) {
    if (!STATUS.missing.includes(message)) {
      STATUS.missing.push(message);
    }
    console.warn("[mira-design-adapter]", message);
  }

  function noteError(message, error) {
    const detail = error && error.message ? error.message : String(error || message);
    STATUS.errors.push({ message, detail });
    console.warn("[mira-design-adapter]", message, error);
  }

  function getConfigFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const supabaseUrl = params.get("supabaseUrl") || "";
    const supabaseAnonKey = params.get("supabaseAnonKey") || "";

    if (!supabaseUrl || !supabaseAnonKey) {
      return null;
    }

    return {
      accessToken: params.get("accessToken") || "",
      backendReady: params.get("backendReady") !== "0",
      supabaseAnonKey,
      supabaseUrl,
      tenantSlug: params.get("tenantSlug") || "demo-hospital",
      userEmail: params.get("userEmail") || "",
    };
  }

  function activeConfig() {
    return window.MIRA_BACKEND_CONFIG || getConfigFromQuery();
  }

  function getAuthHeader(config) {
    return config.accessToken || config.supabaseAnonKey;
  }

  async function rest(config, path) {
    const base = String(config.supabaseUrl || "").replace(/\/+$/, "");
    const response = await fetch(`${base}/rest/v1/${path}`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${getAuthHeader(config)}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    }

    return response.json();
  }

  async function invokeFunction(config, name, body) {
    if (!config.accessToken) {
      noteMissing(`${name} needs a logged-in admin/referral session`);
      return null;
    }

    const base = String(config.supabaseUrl || "").replace(/\/+$/, "");
    const response = await fetch(`${base}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`${name}: ${response.status} ${await response.text()}`);
    }

    return response.json();
  }

  function one(value) {
    return Array.isArray(value) ? value[0] || null : value || null;
  }

  function baht(value) {
    return `฿${Number(value || 0).toLocaleString("th-TH")}`;
  }

  function compact(value, fallback = "—") {
    const text = value == null ? "" : String(value).trim();
    return text || fallback;
  }

  function shortDate(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(new Date(value));
    } catch {
      return "—";
    }
  }

  function orderDisplayId(row) {
    const raw = String(row.id || "");
    if (raw.startsWith("#")) return raw;
    return `#MA-${raw.replace(/-/g, "").slice(0, 4).toUpperCase() || "LIVE"}`;
  }

  function stageFromStatus(status) {
    if (status === "done") return 5;
    if (status === "booked") return 4;
    if (status === "confirmed") return 3;
    if (status === "submitted" || status === "awaiting_payment") return 2;
    return 1;
  }

  function channelLabel(channel) {
    if (channel === "chat_line" || channel === "line") return "LINE OA";
    if (channel === "pwa" || channel === "app") return "AI Chat";
    return compact(channel, "AI Chat");
  }

  function productNameFromOrder(row) {
    return compact(one(row.products)?.name || row.product_name || row.catalog_key, "สินค้า/บริการ");
  }

  function mapOrder(row) {
    const product = one(row.products);
    const branch = one(row.branches);
    const referrer = one(row.referrers);
    const deadline = row.payment_due_at || row.payment_expires_at || row.created_at;
    const deadlineAt = deadline ? new Date(deadline).getTime() + 24 * 60 * 60 * 1000 : Date.now() + 24 * 60 * 60 * 1000;

    return {
      _rawId: row.id,
      id: orderDisplayId(row),
      kind: product?.category === "product" ? "product" : "service",
      customer: compact(row.buyer_name || one(row.customers)?.nickname, "ลูกค้า"),
      phone: compact(row.buyer_phone || one(row.customers)?.phone, "—"),
      channel: channelLabel(row.channel),
      pkg: productNameFromOrder(row),
      amount: baht(row.amount_baht),
      branch: compact(branch?.name || row.preferred_branch, "รอเลือกสาขา"),
      date: compact(row.booking_at || row.preferred_date ? shortDate(row.booking_at || row.preferred_date) : "", "รอนัดหมาย"),
      stage: stageFromStatus(row.status),
      cancelled: row.status === "cancelled",
      archived: row.status === "expired" || row.archived === true,
      expired: row.status === "expired",
      deadlineAt,
      payMethod: compact(row.payment_provider, "PromptPay"),
      referrer: referrer ? `${referrer.name} (${referrer.ref_code})` : "—",
      commission: row.commission_amount_baht ? baht(row.commission_amount_baht) : "฿0",
      transcript: [],
      adminNote: row.admin_note || "",
    };
  }

  function mapProduct(row) {
    return {
      _rawId: row.id,
      title: compact(row.name, "สินค้า/บริการ"),
      type: row.category === "product" ? "product" : "service",
      price: Number(row.price_baht || 0).toLocaleString("th-TH"),
      oldPrice: "",
      category: row.category || "checkup",
      status: row.active === false || row.status === "archived" ? "draft" : "active",
      stock: Number(row.stock_qty || row.stock || 0),
      reserved: Number(row.reserved_qty || row.reserved || 0),
      branches: row.branch_info ? [row.branch_info] : ["องค์กรเดียว"],
      desc: compact(row.description, ""),
      includes: compact(row.description, "").split(/[,\n;]/).map((item) => item.trim()).filter(Boolean).slice(0, 4),
      stripe: Boolean(row.stripe_product_id && row.stripe_price_id),
      rag: row.active !== false,
    };
  }

  function mapReferrer(row, orders) {
    const refOrders = orders.filter((order) => order.referrer && order.referrer.includes(row.ref_code));

    return {
      _rawId: row.id,
      name: compact(row.name, "ผู้แนะนำ"),
      code: compact(row.ref_code, "—"),
      type: "บุคคล",
      phone: compact(row.phone, "—"),
      scheme: "backend commission",
      orders: refOrders.length,
      commission: row.total_commission_baht ? baht(row.total_commission_baht) : "฿0",
      status: row.active === false ? "pending" : "active",
      created: shortDate(row.created_at),
    };
  }

  function mapCommission(row) {
    const referrer = one(row.referrers);
    const order = one(row.orders);
    const product = one(order?.products);

    return {
      _rawId: row.id,
      id: compact(row.id, "CMM").slice(0, 12),
      orderId: orderDisplayId({ id: row.order_id }),
      referrer: compact(referrer?.name, "—"),
      code: compact(referrer?.ref_code, "—"),
      product: compact(product?.name, "ออเดอร์"),
      amount: baht(row.amount_baht),
      status: row.status || "pending",
      date: shortDate(row.created_at),
    };
  }

  function mapConversation(row) {
    const customer = one(row.customers);

    return {
      _rawId: row.id,
      id: `CV-${String(row.id || "").replace(/-/g, "").slice(0, 4).toUpperCase()}`,
      customer: compact(customer?.nickname || customer?.line_user_id, "ลูกค้า"),
      channel: row.channel === "line" ? "LINE" : "AI Chat",
      orderId: null,
      mode: row.agent_mode === "human" ? "human" : "ai",
      unread: 0,
      time: row.last_message_at ? shortDate(row.last_message_at) : "—",
      last: "โหลดจาก backend",
    };
  }

  function derivePayments(orders) {
    return orders.map((order, index) => ({
      id: `PM-${String(index + 1).padStart(4, "0")}`,
      orderId: order.id,
      customer: order.customer,
      amount: order.amount,
      provider: order.payMethod || "PromptPay",
      status: order.stage >= 3 ? "paid" : order.stage === 2 ? "submitted" : "awaiting",
      slip: false,
      session: "backend",
      date: "live",
    }));
  }

  async function loadSnapshot(config) {
    const tenants = await rest(config, `tenants?slug=eq.${encodeURIComponent(config.tenantSlug || "demo-hospital")}&select=id,slug,display_name,logo_url&limit=1`);
    const tenant = tenants[0];

    if (!tenant) {
      throw new Error(`Tenant not found: ${config.tenantSlug || "demo-hospital"}`);
    }

    const tenantFilter = `tenant_id=eq.${tenant.id}`;
    const [productRows, orderRows, referrerRows, commissionRows, conversationRows] = await Promise.all([
      rest(config, `products?${tenantFilter}&select=id,catalog_key,name,description,price_baht,category,image_url,branch_info,requires_appointment,active,stripe_product_id,stripe_price_id,created_at,updated_at&order=created_at.desc&limit=80`).catch((error) => {
        noteError("products fetch failed", error);
        return [];
      }),
      rest(config, `orders?${tenantFilter}&select=id,tenant_id,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,channel,status,slip_url,booking_at,payment_provider,paid_at,admin_note,created_at,updated_at,products(name,category),branches(name),referrers(name,ref_code)&order=created_at.desc&limit=80`).catch((error) => {
        noteError("orders joined fetch failed", error);
        return rest(config, `orders?${tenantFilter}&select=id,tenant_id,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,channel,status,slip_url,booking_at,payment_provider,paid_at,admin_note,created_at,updated_at&order=created_at.desc&limit=80`).catch((fallbackError) => {
          noteError("orders fallback fetch failed", fallbackError);
          return [];
        });
      }),
      rest(config, `referrers?${tenantFilter}&select=id,name,ref_code,phone,active,created_at&order=created_at.desc&limit=80`).catch((error) => {
        noteError("referrers fetch failed", error);
        return [];
      }),
      rest(config, `commission_entries?${tenantFilter}&select=id,order_id,amount_baht,status,created_at,referrers(name,ref_code),orders(amount_baht,products(name))&order=created_at.desc&limit=80`).catch((error) => {
        noteError("commission fetch failed", error);
        return [];
      }),
      rest(config, `chat_sessions?${tenantFilter}&select=id,channel,agent_mode,last_message_at,customers(nickname,line_user_id)&order=last_message_at.desc&limit=30`).catch((error) => {
        noteError("conversation fetch failed", error);
        return [];
      }),
    ]);

    const orders = orderRows.map(mapOrder);

    return {
      commissions: commissionRows.map(mapCommission),
      conversations: conversationRows.map(mapConversation),
      lineWebhook: `${String(config.supabaseUrl).replace(/\/+$/, "")}/functions/v1/line-webhook/${tenant.slug}`,
      orders,
      payments: derivePayments(orders),
      products: productRows.map(mapProduct),
      referrers: referrerRows.map((row) => mapReferrer(row, orders)),
      tenant,
    };
  }

  function rawOrderId(logic, displayId) {
    const order = (logic.state.orders || []).find((row) => row.id === displayId);
    return order && order._rawId;
  }

  function patchActions(logic, config, refresh) {
    if (logic.__miraBackendPatched) return;
    logic.__miraBackendPatched = true;

    const originalAdvance = logic.advanceOrder?.bind(logic);
    const originalCancel = logic.cancelOrder?.bind(logic);
    const originalConfirmPay = logic.confirmPay?.bind(logic);
    const originalRejectPay = logic.rejectPay?.bind(logic);
    const originalSendConv = logic.sendConv?.bind(logic);

    logic.advanceOrder = async (displayId) => {
      const order = (logic.state.orders || []).find((row) => row.id === displayId);
      const action = !order || order.stage <= 2 ? "confirm" : order.stage === 3 ? "book" : "done";
      originalAdvance && originalAdvance(displayId);
      const orderId = rawOrderId(logic, displayId);
      if (!orderId) return;

      try {
        await invokeFunction(config, "admin-order-action", {
          action,
          ...(action === "book" ? { booking_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } : {}),
          order_id: orderId,
        });
        await refresh();
      } catch (error) {
        noteError("admin-order-action advance failed", error);
      }
    };

    logic.cancelOrder = async (displayId) => {
      originalCancel && originalCancel(displayId);
      const orderId = rawOrderId(logic, displayId);
      if (!orderId) return;

      try {
        await invokeFunction(config, "admin-order-action", { action: "cancel", order_id: orderId });
        await refresh();
      } catch (error) {
        noteError("admin-order-action cancel failed", error);
      }
    };

    logic.confirmPay = async (paymentId) => {
      originalConfirmPay && originalConfirmPay(paymentId);
      const payment = (logic._payments || []).find((row) => row.id === paymentId);
      const orderId = payment && rawOrderId(logic, payment.orderId);
      if (!orderId) return;

      try {
        await invokeFunction(config, "admin-order-action", { action: "confirm", order_id: orderId });
        await refresh();
      } catch (error) {
        noteError("payment confirm failed", error);
      }
    };

    logic.rejectPay = async (paymentId) => {
      originalRejectPay && originalRejectPay(paymentId);
      const payment = (logic._payments || []).find((row) => row.id === paymentId);
      const orderId = payment && rawOrderId(logic, payment.orderId);
      if (!orderId) return;

      try {
        await invokeFunction(config, "admin-order-action", { action: "cancel", order_id: orderId });
        await refresh();
      } catch (error) {
        noteError("payment reject failed", error);
      }
    };

    logic.sendConv = async () => {
      originalSendConv && originalSendConv();
      noteMissing("Conversation reply UI exists, but adapter needs selected chat session mapping before calling admin-line-reply.");
    };
  }

  function applySnapshot(logic, config, snapshot) {
    if (snapshot.products.length) logic._products = snapshot.products;
    if (snapshot.referrers.length) logic._referrers = snapshot.referrers;
    if (snapshot.commissions.length) logic._commissions = snapshot.commissions;
    if (snapshot.conversations.length) logic._conversations = snapshot.conversations;
    if (snapshot.payments.length) logic._payments = snapshot.payments;
    if (logic._line && snapshot.lineWebhook) logic._line.webhook = snapshot.lineWebhook;

    logic.setState({
      accountName: snapshot.tenant.display_name || "ทีมแอดมิน",
      dataState: "normal",
      loggedIn: Boolean(config.accessToken) || logic.state.loggedIn,
      orders: snapshot.orders,
      role: "admin",
    });

    STATUS.instance = true;
    STATUS.lastSyncAt = new Date().toISOString();
    STATUS.mode = "backend";
  }

  async function waitForLogic() {
    const existing = window.__dcInstances && Object.values(window.__dcInstances)[0];
    if (existing) return existing;

    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const logic = window.__dcInstances && Object.values(window.__dcInstances)[0];
        if (logic) {
          clearInterval(timer);
          resolve(logic);
        }
      }, 50);

      window.addEventListener("mira:dc-instance", (event) => {
        clearInterval(timer);
        resolve(event.detail.logic);
      }, { once: true });
    });
  }

  async function boot(config) {
    if (!config || !config.backendReady || !config.supabaseUrl || !config.supabaseAnonKey) {
      noteMissing("Supabase public config was not provided by the host app.");
      return;
    }

    const nextSignature = JSON.stringify({
      hasAccessToken: Boolean(config.accessToken),
      supabaseAnonKey: config.supabaseAnonKey,
      supabaseUrl: config.supabaseUrl,
      tenantSlug: config.tenantSlug,
      userEmail: config.userEmail,
    });

    if (bootPromise && bootSignature === nextSignature) {
      return bootPromise;
    }

    bootSignature = nextSignature;
    STATUS.config = true;
    window.MIRA_BACKEND_CONFIG = config;
    bootPromise = (async () => {
      const logic = await waitForLogic();

      const refresh = async () => {
        const snapshot = await loadSnapshot(config);
        applySnapshot(logic, config, snapshot);
      };

      patchActions(logic, config, refresh);

      try {
        await refresh();
      } catch (error) {
        noteError("Initial backend sync failed; keeping original design state.", error);
      }
    })();

    return bootPromise;
  }

  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "MIRA_BACKEND_CONFIG") {
      boot(event.data.config);
    }
  });

  window.addEventListener("DOMContentLoaded", () => {
    const config = activeConfig();
    if (config) boot(config);
    try {
      window.parent.postMessage({ type: "MIRA_DESIGN_READY" }, "*");
    } catch {
      // no-op
    }
  });
})();
