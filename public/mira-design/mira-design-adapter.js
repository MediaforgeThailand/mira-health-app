(() => {
  const SESSION_KEY = "mira-design-supabase-session";
  const STATUS = {
    config: false,
    errors: [],
    instance: false,
    lastAction: null,
    lastSyncAt: null,
    missing: [],
    mode: "loading",
  };

  window.__miraBackendStatus = STATUS;

  let bootSignature = "";
  let bootPromise = null;

  function setMode(mode) {
    STATUS.mode = mode;
  }

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

  function noteAction(message) {
    STATUS.lastAction = { at: new Date().toISOString(), message };
  }

  function compact(value, fallback = "-") {
    const text = value == null ? "" : String(value).trim();
    return text || fallback;
  }

  function numberValue(value) {
    const normalized = String(value || "").replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function baht(value) {
    return `฿${Number(value || 0).toLocaleString("th-TH")}`;
  }

  function qrImageUrl(value, size) {
    if (!value) {
      return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#F5F8FC"/><rect x="12" y="12" width="${size - 24}" height="${size - 24}" rx="12" fill="#fff" stroke="#E8EFF8"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="12" fill="#8595B0">No referrer</text></svg>`)}`;
    }
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}`;
  }

  function monthKey(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function shortDate(value) {
    if (!value) return "-";
    try {
      return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(new Date(value));
    } catch {
      return "-";
    }
  }

  function one(value) {
    return Array.isArray(value) ? value[0] || null : value || null;
  }

  function baseUrl(config) {
    return String(config.supabaseUrl || "").replace(/\/+$/, "");
  }

  function getAuthHeader(config, allowAnon = false) {
    if (config.accessToken) return config.accessToken;
    if (allowAnon) return config.supabaseAnonKey;
    return "";
  }

  async function parseResponse(response) {
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async function rest(config, path, options = {}) {
    const method = options.method || "GET";
    const response = await fetch(`${baseUrl(config)}/rest/v1/${path}`, {
      method,
      headers: {
        Accept: "application/json",
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${getAuthHeader(config, options.allowAnon)}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.prefer ? { Prefer: options.prefer } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    const payload = await parseResponse(response);
    if (!response.ok) {
      const detail = payload && payload.message ? payload.message : typeof payload === "string" ? payload : response.statusText;
      throw new Error(`${response.status} ${detail}`);
    }
    return payload;
  }

  async function invokeFunction(config, name, body, options = {}) {
    const auth = getAuthHeader(config, options.allowAnon);
    if (!auth) {
      throw new Error(`${name} needs a logged-in session`);
    }

    const response = await fetch(`${baseUrl(config)}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = await parseResponse(response);
    if (!response.ok) {
      const detail = payload && payload.error && payload.error.message
        ? payload.error.message
        : payload && payload.message
          ? payload.message
          : typeof payload === "string"
            ? payload
            : response.statusText;
      throw new Error(`${name}: ${detail}`);
    }
    // Edge functions wrap success responses in {ok: true, data: ...} (see
    // supabase/functions/_shared/http.ts). Call sites read fields directly
    // (response.text, response.session_id), so unwrap here; bare-object
    // responses from older functions pass through unchanged.
    if (payload && typeof payload === "object" && payload.ok === true && "data" in payload) {
      return payload.data;
    }
    return payload;
  }

  function getConfigFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const supabaseUrl = params.get("supabaseUrl") || "";
    const supabaseAnonKey = params.get("supabaseAnonKey") || "";

    if (!supabaseUrl || !supabaseAnonKey) return null;

    return {
      accessToken: params.get("accessToken") || "",
      backendReady: params.get("backendReady") !== "0",
      supabaseAnonKey,
      supabaseUrl,
      tenantSlug: params.get("tenantSlug") || "demo-hospital",
      userEmail: params.get("userEmail") || "",
      userId: params.get("userId") || "",
    };
  }

  function readStoredSession(config) {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (session.supabaseUrl !== config.supabaseUrl) return null;
      if (session.expiresAt && Number(session.expiresAt) * 1000 < Date.now() + 60000) return null;
      return session;
    } catch {
      return null;
    }
  }

  function writeStoredSession(config, session) {
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify({
        accessToken: session.access_token,
        expiresAt: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
        refreshToken: session.refresh_token || "",
        supabaseUrl: config.supabaseUrl,
        userEmail: session.user && session.user.email ? session.user.email : "",
        userId: session.user && session.user.id ? session.user.id : "",
      }));
    } catch {
      // Storage can be blocked in embedded contexts; the in-memory config still works.
    }
  }

  function mergeStoredSession(config) {
    if (config.accessToken) return config;
    const session = readStoredSession(config);
    if (!session || !session.accessToken) return config;
    return {
      ...config,
      accessToken: session.accessToken,
      userEmail: session.userEmail || config.userEmail || "",
      userId: session.userId || config.userId || "",
    };
  }

  async function passwordLogin(config, email, password) {
    const response = await fetch(`${baseUrl(config)}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      const detail = payload && payload.msg ? payload.msg : payload && payload.error_description ? payload.error_description : response.statusText;
      throw new Error(detail);
    }
    writeStoredSession(config, payload);
    return payload;
  }

  async function loadAuthUser(config) {
    if (!config.accessToken) return null;
    const response = await fetch(`${baseUrl(config)}/auth/v1/user`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.accessToken}`,
      },
    });
    if (!response.ok) return null;
    return parseResponse(response);
  }

  // Playable public demo: the customer AI-chat needs a real Supabase USER JWT
  // (chat-orchestrator validates it via /auth/v1/user; the anon/publishable key
  // is rejected as "Invalid Supabase JWT"). When the design is opened without a
  // logged-in session (accessToken), silently sign in a sandbox demo customer so
  // the chat just works. A real presenter login still takes precedence.
  const DEMO_CHAT_EMAIL = "demo-play@demo.mediaforge.co";
  const DEMO_CHAT_PASSWORD = "MiraDemoPlay-2026";
  async function ensureDemoAuth(logic) {
    let config = mergeStoredSession(logic.__miraBackendConfig || window.MIRA_BACKEND_CONFIG || {});
    if (!config.accessToken && config.supabaseUrl && config.supabaseAnonKey) {
      try {
        const session = await passwordLogin(config, DEMO_CHAT_EMAIL, DEMO_CHAT_PASSWORD);
        config = {
          ...config,
          accessToken: session.access_token,
          userEmail: (session.user && session.user.email) || config.userEmail || "",
          userId: (session.user && session.user.id) || config.userId || "",
        };
      } catch (error) {
        // Leave config unchanged; sendChat surfaces the backend error as before.
      }
    }
    logic.__miraBackendConfig = config;
    window.MIRA_BACKEND_CONFIG = config;
    return config;
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
    if (channel === "chat_pwa" || channel === "pwa") return "Web Chat";
    if (channel === "referrer") return "Referral";
    return compact(channel, "AI Chat");
  }

  function paymentStatus(row) {
    if (row.paid_at || row.status === "confirmed" || row.status === "booked" || row.status === "done") return "paid";
    if (row.status === "submitted") return "submitted";
    if (row.status === "cancelled" && row.paid_at) return "refund";
    if (row.status === "cancelled") return "failed";
    return "awaiting";
  }

  function mapOrder(row, commissionByOrder) {
    const product = one(row.products);
    const branch = one(row.branches);
    const referrer = one(row.referrers);
    const deadline = row.payment_due_at || row.payment_expires_at || row.created_at;
    const deadlineAt = deadline ? new Date(deadline).getTime() + 24 * 60 * 60 * 1000 : Date.now() + 24 * 60 * 60 * 1000;
    const commission = commissionByOrder.get(row.id);

    return {
      _raw: row,
      _rawId: row.id,
      id: orderDisplayId(row),
      kind: product && product.category === "product" ? "product" : "service",
      customer: compact(row.buyer_name || one(row.customers)?.nickname, "ลูกค้า"),
      phone: compact(row.buyer_phone || one(row.customers)?.phone, "-"),
      channel: channelLabel(row.channel),
      pkg: compact(product?.name || row.product_name || row.catalog_key, "สินค้า/บริการ"),
      amount: baht(row.amount_baht),
      branch: compact(branch?.name || row.preferred_branch, "รอเลือกสาขา"),
      date: compact(row.booking_at || row.preferred_date ? shortDate(row.booking_at || row.preferred_date) : "", "รอนัดหมาย"),
      stage: stageFromStatus(row.status),
      cancelled: row.status === "cancelled",
      archived: row.status === "expired" || row.archived === true,
      expired: row.status === "expired",
      deadlineAt,
      payMethod: compact(row.payment_provider, "PromptPay"),
      referrer: referrer ? `${referrer.name} (${referrer.ref_code})` : "-",
      commission: commission ? baht(commission.amount_baht) : "฿0",
      transcript: [],
      adminNote: row.admin_note || "",
    };
  }

  function mapProduct(row, branchMap) {
    const branchInfo = branchMap.get(row.id) || { ids: [], names: [] };
    return {
      _raw: row,
      _rawId: row.id,
      _catalogKey: row.catalog_key || "",
      _branchIds: branchInfo.ids,
      title: compact(row.name, "สินค้า/บริการ"),
      type: row.category === "product" ? "product" : "service",
      price: Number(row.price_baht || 0).toLocaleString("th-TH"),
      oldPrice: "",
      category: row.category || "general",
      status: row.active === false ? "draft" : "active",
      stock: 0,
      reserved: 0,
      branches: branchInfo.names.length ? branchInfo.names : row.branch_info ? [row.branch_info] : [],
      desc: compact(row.description, ""),
      includes: compact(row.description, "").split(/[,\n;]/).map((item) => item.trim()).filter(Boolean).slice(0, 4),
      stripe: Boolean(row.stripe_product_id && row.stripe_price_id),
      rag: row.active !== false,
    };
  }

  function mapReferrer(row, orders, commissions) {
    const refOrders = orders.filter((order) => order.referrer && order.referrer.includes(row.ref_code));
    const refCommissions = commissions.filter((entry) => entry.referrer_id === row.id);
    const total = refCommissions.reduce((sum, entry) => sum + Number(entry.amount_baht || 0), 0);

    return {
      _raw: row,
      _rawId: row.id,
      authUserId: row.auth_user_id || "",
      name: compact(row.name, "ผู้แนะนำ"),
      code: compact(row.ref_code, "-"),
      type: row.type || "staff",
      phone: compact(row.phone, "-"),
      scheme: row.commission_scheme ? "backend commission" : "-",
      orders: refOrders.length,
      commission: baht(total),
      status: row.active === false ? "pending" : "active",
      created: shortDate(row.created_at),
    };
  }

  function mapCommission(row) {
    const referrer = one(row.referrers);
    const order = one(row.orders);
    const product = one(order?.products);
    return {
      _raw: row,
      _rawId: row.id,
      id: compact(row.id, "CMM").slice(0, 12),
      orderId: orderDisplayId({ id: row.order_id }),
      referrer: compact(referrer?.name, "-"),
      code: compact(referrer?.ref_code, "-"),
      product: compact(product?.name, "ออเดอร์"),
      amount: baht(row.amount_baht),
      status: row.status || "pending",
      date: shortDate(row.created_at),
    };
  }

  function mapBranch(row, productCounts) {
    return {
      _raw: row,
      _rawId: row.id,
      active: row.active !== false,
      address: compact(row.address, "-"),
      district: compact(row.district, "-"),
      name: compact(row.name, "-"),
      phone: compact(row.phone, "-"),
      products: productCounts.get(row.id) || 0,
    };
  }

  function messageBubble(role, text) {
    if (role === "user") {
      return {
        bubbleStyle: "align-self:flex-start; max-width:76%; padding:10px 13px; border-radius:4px 13px 13px 13px; background:#fff; border:1px solid #E9EEF6; color:#0E2143; font-size:13.5px; line-height:1.45;",
        role,
        text,
      };
    }
    if (role === "agent") {
      return {
        bubbleStyle: "align-self:flex-end; max-width:76%; padding:10px 13px; border-radius:13px 13px 4px 13px; background:#0E2143; color:#fff; font-size:13.5px; line-height:1.45;",
        role,
        text,
      };
    }
    if (role === "me") {
      return {
        bubbleStyle: "align-self:flex-end; max-width:76%; padding:10px 13px; border-radius:13px 13px 4px 13px; background:#2563EB; color:#fff; font-size:13.5px; line-height:1.45;",
        role,
        text,
      };
    }
    if (role === "mira") {
      return {
        bubbleStyle: "align-self:flex-start; max-width:76%; padding:10px 13px; border-radius:4px 13px 13px 13px; background:#fff; border:1px solid #E9EEF6; color:#0E2143; font-size:13.5px; line-height:1.45;",
        role,
        text,
      };
    }
    return {
      bubbleStyle: "align-self:flex-end; max-width:76%; padding:10px 13px; border-radius:13px 13px 4px 13px; background:#2563EB; color:#fff; font-size:13.5px; line-height:1.45;",
      role,
      text,
    };
  }

  function mapConversation(row, messagesBySession, orderBySession) {
    const customer = one(row.customers);
    const messages = messagesBySession.get(row.id) || [];
    const last = messages[messages.length - 1];
    return {
      _raw: row,
      _rawId: row.id,
      channel: row.channel === "line" ? "LINE" : channelLabel(row.channel),
      customer: compact(customer?.nickname || customer?.line_user_id, "ลูกค้า"),
      id: `CV-${String(row.id || "").replace(/-/g, "").slice(0, 4).toUpperCase()}`,
      last: compact(last?.content, "ยังไม่มีข้อความ"),
      mode: row.agent_mode === "human" ? "human" : "ai",
      orderId: orderBySession.get(row.id) || null,
      time: row.last_message_at ? shortDate(row.last_message_at) : "-",
      transcript: messages.map((message) => ({
        role: message.role === "user" ? "user" : message.role === "assistant" ? "ai" : "agent",
        text: message.content,
      })),
      unread: 0,
    };
  }

  function derivePayments(orderRows, orders) {
    const byId = new Map(orders.map((order) => [order._rawId, order]));
    return orderRows.map((row) => {
      const order = byId.get(row.id);
      return {
        _raw: row,
        _rawId: row.id,
        amount: baht(row.amount_baht),
        customer: order ? order.customer : compact(row.buyer_name, "ลูกค้า"),
        date: row.updated_at ? shortDate(row.updated_at) : shortDate(row.created_at),
        id: `PM-${String(row.id || "").replace(/-/g, "").slice(0, 8).toUpperCase()}`,
        orderId: order ? order.id : orderDisplayId(row),
        provider: row.payment_provider && row.payment_provider.includes("stripe") ? "Stripe" : "PromptPay",
        session: row.stripe_checkout_session_id || row.stripe_payment_intent_id || "-",
        slip: Boolean(row.slip_url),
        status: paymentStatus(row),
      };
    });
  }

  function emptyLine(config, tenant) {
    return {
      accessToken: false,
      channelSecret: false,
      events: [],
      lastEvent: { time: "-", type: "No live LINE event loaded" },
      lastReply: { status: "-", time: "-" },
      verified: false,
      webhook: tenant ? `${baseUrl(config)}/functions/v1/line-webhook/${tenant.slug}` : "",
    };
  }

  function buildBranchMap(productBranchRows) {
    const branchMap = new Map();
    const productCounts = new Map();
    for (const row of productBranchRows) {
      const current = branchMap.get(row.product_id) || { ids: [], names: [] };
      if (row.branch_id) current.ids.push(row.branch_id);
      const branch = one(row.branches);
      if (branch && branch.name) {
        current.names.push(branch.name);
        productCounts.set(row.branch_id, (productCounts.get(row.branch_id) || 0) + 1);
      }
      branchMap.set(row.product_id, current);
    }
    return { branchMap, productCounts };
  }

  async function loadSnapshot(config) {
    const tenants = await rest(config, `tenants?slug=eq.${encodeURIComponent(config.tenantSlug || "demo-hospital")}&select=id,slug,display_name,logo_url&limit=1`);
    const tenant = tenants[0];
    if (!tenant) throw new Error(`Tenant not found: ${config.tenantSlug || "demo-hospital"}`);

    const tenantFilter = `tenant_id=eq.${tenant.id}`;
    const user = await loadAuthUser(config);
    const [memberships, productRows, orderRows, referrerRows, commissionRows, conversationRows, branchRows] = await Promise.all([
      rest(config, `tenant_members?${tenantFilter}&select=role&limit=1`).catch(() => []),
      rest(config, `products?${tenantFilter}&select=id,tenant_id,catalog_key,name,description,price_baht,category,image_url,branch_info,requires_appointment,active,stripe_product_id,stripe_price_id,created_at,updated_at&order=created_at.desc&limit=120`).catch((error) => {
        noteError("products fetch failed", error);
        return [];
      }),
      rest(config, `orders?${tenantFilter}&select=id,tenant_id,customer_id,session_id,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,channel,status,slip_url,booking_at,payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_payment_status,paid_at,admin_note,created_at,updated_at,products(name,category),branches(name),customers(nickname,phone),referrers(name,ref_code)&order=created_at.desc&limit=120`).catch((error) => {
        noteError("orders fetch failed", error);
        return [];
      }),
      rest(config, `referrers?${tenantFilter}&select=id,tenant_id,name,ref_code,type,phone,auth_user_id,commission_scheme,active,created_at&order=created_at.desc&limit=120`).catch((error) => {
        noteError("referrers fetch failed", error);
        return [];
      }),
      rest(config, `commission_entries?${tenantFilter}&select=id,tenant_id,referrer_id,order_id,amount_baht,status,created_at,referrers(name,ref_code),orders(amount_baht,products(name))&order=created_at.desc&limit=120`).catch((error) => {
        noteError("commission fetch failed", error);
        return [];
      }),
      rest(config, `chat_sessions?${tenantFilter}&select=id,tenant_id,channel,agent_mode,last_message_at,customers(nickname,line_user_id)&order=last_message_at.desc&limit=60`).catch((error) => {
        noteError("conversation fetch failed", error);
        return [];
      }),
      rest(config, `branches?${tenantFilter}&select=id,tenant_id,name,address,district,phone,map_url,image_url,active,sort,created_at&order=sort.asc,created_at.asc&limit=100`).catch((error) => {
        noteError("branches fetch failed", error);
        return [];
      }),
    ]);

    const productIds = productRows.map((row) => row.id).filter(Boolean);
    const sessionIds = conversationRows.map((row) => row.id).filter(Boolean);
    const productBranchRows = productIds.length
      ? await rest(config, `product_branches?product_id=in.(${productIds.join(",")})&select=product_id,branch_id,branches(name,active)&limit=500`).catch(() => [])
      : [];
    const chatMessages = sessionIds.length
      ? await rest(config, `chat_messages?session_id=in.(${sessionIds.join(",")})&select=id,session_id,role,content,created_at&order=created_at.asc&limit=500`).catch((error) => {
        noteError("chat messages fetch failed", error);
        return [];
      })
      : [];

    const { branchMap, productCounts } = buildBranchMap(productBranchRows);
    const commissionByOrder = new Map(commissionRows.map((entry) => [entry.order_id, entry]));
    const orders = orderRows.map((row) => mapOrder(row, commissionByOrder));
    const orderBySession = new Map(orderRows.filter((row) => row.session_id).map((row) => [row.session_id, orderDisplayId(row)]));
    const messagesBySession = new Map();
    for (const message of chatMessages) {
      const list = messagesBySession.get(message.session_id) || [];
      list.push(message);
      messagesBySession.set(message.session_id, list);
    }
    const currentReferrerRow = user && user.id
      ? referrerRows.find((row) => row.auth_user_id === user.id) || null
      : null;

    return {
      branches: branchRows.map((row) => mapBranch(row, productCounts)),
      commissions: commissionRows.map(mapCommission),
      config,
      conversations: conversationRows.map((row) => mapConversation(row, messagesBySession, orderBySession)),
      currentReferrer: currentReferrerRow ? mapReferrer(currentReferrerRow, orders, commissionRows) : null,
      line: emptyLine(config, tenant),
      membershipRole: memberships[0]?.role || "",
      orders,
      orderRows,
      payments: derivePayments(orderRows, orders),
      products: productRows.map((row) => mapProduct(row, branchMap)),
      referrers: referrerRows.map((row) => mapReferrer(row, orders, commissionRows)),
      tenant,
      user,
    };
  }

  function resetDesignData(logic, options = {}) {
    logic._branches = [];
    logic._commissions = [];
    logic._conversations = [];
    logic._line = emptyLine(window.MIRA_BACKEND_CONFIG || {}, null);
    logic._payments = [];
    logic._products = [];
    logic._referrers = [];
    logic.__miraSnapshot = {
      branches: [],
      commissions: [],
      conversations: [],
      currentReferrer: null,
      line: logic._line,
      orders: [],
      payments: [],
      products: [],
      referrers: [],
    };
    logic.setState({
      dataState: options.dataState || "empty",
      lineConn: "missing",
      loggedIn: Boolean(options.loggedIn),
      orders: [],
      showLogin: Boolean(options.showLogin),
      stockBook: {},
    });
  }

  function rawOrderId(logic, displayId) {
    const order = (logic.state.orders || []).find((row) => row.id === displayId);
    return order && order._rawId;
  }

  function rawProductId(logic, product) {
    return product && (product._rawId || product._raw?.id);
  }

  function rawCommissionId(logic, displayId) {
    const entry = (logic._commissions || []).find((row) => row.id === displayId);
    return entry && entry._rawId;
  }

  function selectedConversation(logic) {
    const conversations = logic._conversations || [];
    if (conversations.length === 0) return null;
    const selectedId = logic.state.convId || conversations[0].id;
    return conversations.find((item) => item.id === selectedId) || conversations[0];
  }

  async function refreshFromLogic(logic) {
    if (!logic.__miraRefresh) throw new Error("Backend refresh is not ready.");
    await logic.__miraRefresh();
  }

  function patchConvModel(logic) {
    if (logic.__miraConvModelPatched) return;
    const original = logic._convModel?.bind(logic);
    logic._convModel = function patchedConvModel(state) {
      const conversations = this._conversations || [];
      if (conversations.length === 0) {
        return {
          list: [],
          order: null,
          sel: { avatar: "-", channel: "-", channelBg: "#F1F5F9", channelFg: "#64748B", customer: "ไม่มีบทสนทนา", effMode: "ai", id: "-", last: "-", mode: "ai", time: "-", unread: 0 },
          transcript: [],
        };
      }
      const model = original ? original(state) : { list: [], order: null, sel: conversations[0], transcript: [] };
      const selectedId = state.convId || conversations[0].id;
      const selected = conversations.find((item) => item.id === selectedId) || conversations[0];
      if (selected.transcript && selected.transcript.length > 0) {
        model.transcript = selected.transcript.map((message) => messageBubble(message.role === "user" ? "user" : message.role === "agent" ? "agent" : "ai", message.text));
      }
      return model;
    };
    logic.__miraConvModelPatched = true;
  }

  function productPayload(logic, tenantId) {
    const fd = logic.state.formData || {};
    const name = compact(fd.title, "");
    const price = numberValue(fd.price);
    if (!name) throw new Error("Product name is required.");
    if (!Number.isInteger(price) || price < 0) throw new Error("Product price must be a valid baht amount.");
    return {
      active: fd.status === "active",
      branch_info: Array.isArray(fd.branches) && fd.branches.length ? fd.branches.join(", ") : null,
      category: fd.type === "product" ? "product" : fd.category || "general",
      description: compact(fd.desc, ""),
      name,
      price_baht: price,
      requires_appointment: fd.type !== "product",
      tenant_id: tenantId,
      updated_at: new Date().toISOString(),
    };
  }

  function productCheckoutPayload(product) {
    const priceNumber = numberValue(product.price);
    return {
      _branchIds: product._branchIds || [],
      _catalogKey: product._catalogKey || product.catalog_key || "",
      _rawId: product._rawId || product._raw?.id || "",
      branches: Array.isArray(product.branches) ? product.branches : [],
      includes: Array.isArray(product.includes) ? product.includes : [],
      oldPrice: product.oldPrice ? (String(product.oldPrice).startsWith("฿") ? product.oldPrice : baht(numberValue(product.oldPrice))) : "",
      price: String(product.price || "").startsWith("฿") ? product.price : baht(priceNumber),
      sub: compact(product.desc || product.description || product.sub, ""),
      title: compact(product.title || product.name, "สินค้า/บริการ"),
      type: product.type || (product.category === "product" ? "product" : "service"),
    };
  }

  function branchIdForProductSelection(product, branchName) {
    const branches = Array.isArray(product.branches) ? product.branches : [];
    const branchIds = Array.isArray(product._branchIds) ? product._branchIds : [];
    const index = branches.findIndex((name) => name === branchName);
    return index >= 0 ? branchIds[index] : "";
  }

  function referrerType(value) {
    const raw = compact(value, "staff").toLowerCase();
    if (raw.includes("creator")) return "creator";
    if (raw.includes("doctor") || raw.includes("แพทย์")) return "doctor";
    if (raw.includes("nurse") || raw.includes("พยาบาล")) return "nurse";
    return "staff";
  }

  function commissionSchemeFromForm(form) {
    const defaultRate = numberValue(form.sOther || form.sCheckup || 10) || 10;
    return {
      by_category: {
        blood: numberValue(form.sBlood || defaultRate) || defaultRate,
        checkup: numberValue(form.sCheckup || defaultRate) || defaultRate,
        heart: numberValue(form.sHeart || defaultRate) || defaultRate,
      },
      default: defaultRate,
      mode: "percent",
    };
  }

  function schemeToFormValues(scheme) {
    const defaultRate = scheme && Number.isFinite(Number(scheme.default)) ? Number(scheme.default) : 10;
    const byCategory = scheme && scheme.by_category ? scheme.by_category : {};
    return {
      sBlood: String(byCategory.blood ?? defaultRate),
      sCheckup: String(byCategory.checkup ?? defaultRate),
      sHeart: String(byCategory.heart ?? defaultRate),
      sOther: String(defaultRate),
    };
  }

  function bookingAtFromFulfill(data) {
    const date = compact(data.date, "");
    if (!date) return "";
    const match = compact(data.time, "").match(/(\d{2}):(\d{2})/);
    const hour = match ? match[1] : "09";
    const minute = match ? match[2] : "00";
    return `${date}T${hour}:${minute}:00+07:00`;
  }

  function patchActions(logic, config, refresh) {
    logic.__miraBackendConfig = config;
    logic.__miraRefresh = refresh;
    patchConvModel(logic);
    patchRenderVals(logic);

    if (logic.__miraBackendPatched) return;
    logic.__miraBackendPatched = true;

    const originalOpenForm = logic.openForm?.bind(logic);

    logic.openBackendCheckout = (product) => {
      const checkoutProduct = productCheckoutPayload(product || {});
      if (!checkoutProduct._catalogKey && !checkoutProduct._rawId) {
        noteMissing("Checkout needs a real backend catalog product.");
        return;
      }
      logic.setState({
        coError: "",
        coForm: {
          addr: "",
          age: "",
          branch: (checkoutProduct.branches && checkoutProduct.branches[0]) || "",
          date: "",
          name: "",
          note: "",
          phone: "",
          qty: 1,
          shipNote: "",
          time: "เช้า (09:00-12:00)",
        },
        coLoading: false,
        coOpen: true,
        coOrderId: "",
        coPay: "promptpay",
        coProduct: checkoutProduct,
        coStatus: "",
        coStep: "detail",
      });
    };

    logic.openForm = (mode, product) => {
      originalOpenForm && originalOpenForm(mode, product);
      const current = product || {};
      logic.setState({ formData: { ...current, _rawId: rawProductId(logic, current) } });
    };

    logic.openRefCreate2 = () => {
      logic.setState({
        refDrawerCode: "__new__",
        refError: "",
        refForm: {
          code: "",
          email: "",
          name: "",
          phone: "",
          status: "pending",
          type: "staff",
          ...schemeToFormValues({ default: 10, by_category: {} }),
        },
      });
    };

    logic.openRefProfile = (code) => {
      const referrer = (logic._referrers || []).find((row) => row.code === code);
      if (!referrer) {
        noteMissing("Referrer drawer needs a backend referrer row.");
        return;
      }
      const schemeValues = schemeToFormValues(referrer._raw && referrer._raw.commission_scheme);
      logic.setState({
        refDrawerCode: referrer.code,
        refError: "",
        refForm: {
          code: referrer.code,
          email: "",
          name: referrer.name,
          phone: referrer.phone === "-" ? "" : referrer.phone,
          status: referrer.status,
          type: referrer.type,
          ...schemeValues,
        },
      });
    };

    logic.submitLogin = async () => {
      const state = logic.state || {};
      let email = compact(state.loginEmail, "");
      let password = compact(state.loginPwd, "");
      // AI Chat (customer) is a public playable demo: let the presenter enter the
      // chat in one click by falling back to the sandbox demo customer when no
      // credentials are typed. Admin/Referral still require real credentials.
      if (state.loginRole === "customer" && (!email || !password)) {
        email = DEMO_CHAT_EMAIL;
        password = DEMO_CHAT_PASSWORD;
      }
      if (!email || !password) {
        logic.setState({ loginError: "กรุณากรอกอีเมลและรหัสผ่านให้ครบ" });
        return;
      }

      try {
        logic.setState({ loginError: "กำลังเข้าสู่ระบบ..." });
        const baseConfig = logic.__miraBackendConfig || window.MIRA_BACKEND_CONFIG;
        const session = await passwordLogin(baseConfig, email, password);
        const nextConfig = {
          ...baseConfig,
          accessToken: session.access_token,
          userEmail: session.user?.email || email,
          userId: session.user?.id || "",
        };
        window.MIRA_BACKEND_CONFIG = nextConfig;
        logic.__miraBackendConfig = nextConfig;
        const route = { admin: "admin", customer: "chat", referral: "referral" }[state.loginRole] || "admin";
        logic.setState({
          loggedIn: true,
          loginError: "",
          loginPwd: "",
          module: route,
          role: state.loginRole || "admin",
          showLogin: false,
        });
        await boot(nextConfig, { force: true });
      } catch (error) {
        noteError("login failed", error);
        logic.setState({ loginError: error.message || "เข้าสู่ระบบไม่สำเร็จ" });
      }
    };

    logic.advanceOrder = async (displayId) => {
      const order = (logic.state.orders || []).find((row) => row.id === displayId);
      const action = !order || order.stage <= 2 ? "confirm" : order.stage === 3 ? "book" : "done";
      const orderId = rawOrderId(logic, displayId);
      if (!orderId) {
        noteMissing("Order action blocked because this row is not linked to a backend order.");
        return;
      }
      try {
        await invokeFunction(logic.__miraBackendConfig, "admin-order-action", {
          action,
          ...(action === "book" ? { booking_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } : {}),
          order_id: orderId,
        });
        noteAction(`order ${displayId} ${action}`);
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("admin-order-action advance failed", error);
      }
    };

    logic.cancelOrder = async (displayId) => {
      const orderId = rawOrderId(logic, displayId);
      if (!orderId) {
        noteMissing("Cancel blocked because this row is not linked to a backend order.");
        return;
      }
      try {
        await invokeFunction(logic.__miraBackendConfig, "admin-order-action", { action: "cancel", order_id: orderId });
        noteAction(`order ${displayId} cancel`);
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("admin-order-action cancel failed", error);
      }
    };

    logic.bulkAction = async (kind) => {
      const selected = logic.state.ordSel || {};
      const displayIds = Object.keys(selected).filter((id) => selected[id]);
      const action = kind === "archive" ? null : kind === "cancel" ? "cancel" : "confirm";
      if (!action) {
        noteMissing("Archive has no backend action in the protected order state machine.");
        logic.setState({ ordSel: {} });
        return;
      }
      for (const displayId of displayIds) {
        const orderId = rawOrderId(logic, displayId);
        if (orderId) {
          await invokeFunction(logic.__miraBackendConfig, "admin-order-action", { action, order_id: orderId });
        }
      }
      logic.setState({ ordSel: {} });
      noteAction(`bulk order ${action} ${displayIds.length}`);
      await refreshFromLogic(logic);
    };

    logic.confirmPay = async (paymentId) => {
      const payment = (logic._payments || []).find((row) => row.id === paymentId);
      const orderId = payment && payment._rawId;
      if (!orderId) return;
      try {
        await invokeFunction(logic.__miraBackendConfig, "admin-order-action", { action: "confirm", order_id: orderId });
        noteAction(`payment ${paymentId} confirm`);
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("payment confirm failed", error);
      }
    };

    logic.rejectPay = async (paymentId) => {
      const payment = (logic._payments || []).find((row) => row.id === paymentId);
      const orderId = payment && payment._rawId;
      if (!orderId) return;
      try {
        await invokeFunction(logic.__miraBackendConfig, "admin-order-action", { action: "cancel", order_id: orderId });
        noteAction(`payment ${paymentId} reject`);
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("payment reject failed", error);
      }
    };

    logic.saveProductForm = async () => {
      const snapshot = logic.__miraSnapshot || {};
      const tenantId = snapshot.tenant && snapshot.tenant.id;
      if (!tenantId) {
        noteMissing("Product save needs a loaded tenant.");
        return;
      }
      try {
        const payload = productPayload(logic, tenantId);
        const productId = logic.state.formData && logic.state.formData._rawId;
        if (productId) {
          await rest(logic.__miraBackendConfig, `products?id=eq.${productId}&tenant_id=eq.${tenantId}&select=id`, {
            body: payload,
            method: "PATCH",
            prefer: "return=representation",
          });
        } else {
          await rest(logic.__miraBackendConfig, "products?select=id", {
            body: payload,
            method: "POST",
            prefer: "return=representation",
          });
        }
        logic.setState({ showForm: false });
        noteAction(productId ? "product updated" : "product created");
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("product save failed", error);
        logic.setState({ loginError: error.message || "Product save failed" });
      }
    };

    logic.syncStripe = async () => {
      const productId = logic.state.formData && logic.state.formData._rawId;
      if (!productId) {
        noteMissing("Save the product before syncing Stripe.");
        return;
      }
      try {
        await invokeFunction(logic.__miraBackendConfig, "admin-stripe-product-sync", { product_id: productId });
        noteAction("product Stripe sync");
        await refreshFromLogic(logic);
        logic.setState((state) => ({ formData: { ...(state.formData || {}), stripe: true } }));
      } catch (error) {
        noteError("Stripe product sync failed", error);
      }
    };

    logic.applyStock = () => {
      noteMissing("Stock controls are visible in the supplied UI, but production products do not have stock/reserved columns yet.");
    };

    logic.applyStockMove = () => {
      noteMissing("Inventory movement UI is present, but production has no stock ledger/movement backend contract yet.");
      logic.setState({ stMoveNote: "", stMoveQty: "" });
    };

    logic.enableStockTracking = () => {
      noteMissing("Stock tracking toggle needs production stock columns or a stock ledger table before it can persist.");
    };

    logic.copyLink = async () => {
      const snapshot = logic.__miraSnapshot || {};
      const currentReferrer = snapshot.currentReferrer || null;
      const refCode = logic.state.qrRef || (currentReferrer && currentReferrer.code) || "";
      const link = refCode ? `${window.location.origin}/r/${encodeURIComponent(refCode)}` : "";
      if (!link) {
        noteMissing("Copy link needs a real referrer profile/ref_code from the backend.");
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        noteAction(`copied referral link ${refCode}`);
      } catch (error) {
        noteError("copy referral link failed", error);
      }
      logic.setState({ copied: true });
      if (Array.isArray(logic._timers)) {
        logic._timers.push(setTimeout(() => logic.setState({ copied: false }), 1600));
      }
    };

    logic.setCommStatus = async (displayId, status) => {
      const id = rawCommissionId(logic, displayId) || displayId;
      try {
        await rest(logic.__miraBackendConfig, `commission_entries?id=eq.${id}`, {
          body: { status },
          method: "PATCH",
          prefer: "return=minimal",
        });
        noteAction(`commission ${displayId} ${status}`);
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("commission update failed", error);
      }
    };

    logic.commBulk = async (status) => {
      const selected = Object.keys(logic.state.commSel || {}).filter((id) => logic.state.commSel[id]);
      for (const displayId of selected) {
        const id = rawCommissionId(logic, displayId) || displayId;
        await rest(logic.__miraBackendConfig, `commission_entries?id=eq.${id}`, {
          body: { status },
          method: "PATCH",
          prefer: "return=minimal",
        });
      }
      logic.setState({ commSel: {} });
      noteAction(`bulk commission ${status} ${selected.length}`);
      await refreshFromLogic(logic);
    };

    logic.sendConv = async () => {
      const text = compact(logic.state.convInput, "");
      const conversation = selectedConversation(logic);
      if (!text || !conversation || !conversation._rawId) return;
      try {
        await invokeFunction(logic.__miraBackendConfig, "admin-line-reply", {
          action: "reply",
          session_id: conversation._rawId,
          text,
        });
        logic.setState({ convInput: "" });
        noteAction(`conversation ${conversation.id} reply`);
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("conversation reply failed", error);
      }
    };

    logic.sendLineTest = () => {
      noteMissing("LINE test send has no production backend contract in this UI. Configure/test LINE through the live webhook and chat inbox.");
      logic.setState({ lineTestText: "" });
    };

    logic.verifyLine = () => {
      noteMissing("LINE verify button in the supplied UI is a mock timer. Production verification needs a backend health-check contract for LINE credentials/webhook.");
      logic.setState({ lineVerifying: false, lineConn: "missing" });
    };

    logic._createOrder = () => {
      noteMissing("Design in-memory order creation is disabled. Orders must be created by a production backend contract.");
      return "";
    };

    logic._addCommission = () => {
      noteMissing("Design in-memory commission creation is disabled. Commissions must come from commission_entries.");
    };

    logic.coCreateOrder = () => {
      noteMissing("AI checkout bottom sheet has UI, but there is no production create-order API for this direct form yet. Use the live AI chat flow until a backend contract is added.");
      logic.setState({
        coError: "ยังไม่มี backend สำหรับสร้างออเดอร์จากฟอร์ม AI Checkout นี้โดยตรง กรุณาใช้แชต AI จริง หรือเพิ่ม contract สร้างออเดอร์ก่อน",
        coLoading: false,
      });
    };

    logic.coConfirmPay = () => {
      noteMissing("AI checkout payment confirmation needs a real backend order id plus PromptPay/Stripe/slip verification contract.");
      logic.setState({
        coError: "ยังยืนยันชำระเงินจาก bottom sheet นี้ไม่ได้ เพราะยังไม่มีออเดอร์จริงจาก backend",
        coLoading: false,
      });
    };

    logic.rcCreate = async () => {
      if (logic.state.rcLoading) return;
      const configNow = logic.__miraBackendConfig || window.MIRA_BACKEND_CONFIG || {};
      const product = logic.state.rcProduct || {};
      const form = logic.state.rcForm || {};
      const buyerAge = Number(form.age);
      const catalogKey = product._catalogKey || product.catalog_key || "";
      if (!catalogKey) {
        logic.setState({ rcError: "สินค้านี้ยังไม่มี catalog_key จาก backend", rcLoading: false });
        noteMissing("Referral direct purchase needs a backend catalog_key.");
        return;
      }
      if (product.type === "product") {
        logic.setState({ rcError: "สินค้าจัดส่งยังไม่มี field ที่อยู่จัดส่งใน referrer-order contract", rcLoading: false });
        noteMissing("Referral product shipment needs a backend shipping-address contract before it can create real orders.");
        return;
      }
      if (!form.name || !form.phone || !Number.isInteger(buyerAge) || buyerAge < 1 || buyerAge > 120) {
        logic.setState({ rcError: "กรอกชื่อ เบอร์โทร และอายุลูกค้าให้ครบ", rcLoading: false });
        return;
      }
      try {
        logic.setState({ rcError: "", rcLoading: true });
        const branchId = branchIdForProductSelection(product, form.branch);
        const response = await invokeFunction(configNow, "referrer-order", {
          action: "create_order",
          buyer_age: buyerAge,
          buyer_name: String(form.name).trim(),
          buyer_phone: String(form.phone).trim(),
          catalog_key: catalogKey,
          ...(branchId ? { branch_id: branchId } : {}),
          ...(form.date ? { preferred_date: form.date } : {}),
          tenant_slug: configNow.tenantSlug || "demo-hospital",
        });
        const displayId = response && response.order && response.order.id ? orderDisplayId(response.order) : "";
        const entry = {
          amount: product.price || "",
          commission: "รอคำนวณหลังชำระเงิน",
          custShort: logic._shortName ? logic._shortName(form.name) : compact(form.name, ""),
          id: displayId || "backend",
          pkg: product.title || "",
          status: "รอชำระ",
        };
        logic.setState((state) => ({
          rcCreated: [entry].concat(state.rcCreated || []),
          rcLoading: false,
          rcOrderId: displayId,
          rcStep: "success",
        }));
        noteAction(`referral order created ${displayId || ""}`.trim());
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("referrer-order create failed", error);
        logic.setState({ rcError: error.message || "สร้างออเดอร์ referral ไม่สำเร็จ", rcLoading: false });
      }
    };

    logic.confirmFulfill = async () => {
      if (logic.state.fulfillLoading) return;
      const displayId = logic.state.fulfillOrderId;
      const orderId = rawOrderId(logic, displayId);
      const data = logic.state.fulfillData || {};
      if (!orderId) {
        logic.setState({ fulfillError: "ออเดอร์นี้ยังไม่ผูกกับ backend order id" });
        noteMissing("Fulfillment action needs a backend order id.");
        return;
      }
      if (logic.state.fulfillKind === "product") {
        logic.setState({ fulfillError: "ยังไม่มี backend field สำหรับ courier/tracking ของสินค้าจัดส่ง" });
        noteMissing("Product fulfillment needs courier/tracking fields and a backend action before it can persist.");
        return;
      }
      const bookingAt = bookingAtFromFulfill(data);
      if (!bookingAt) {
        logic.setState({ fulfillError: "เลือกวันนัดหมายก่อนบันทึก" });
        return;
      }
      try {
        logic.setState({ fulfillError: "", fulfillLoading: true });
        await invokeFunction(logic.__miraBackendConfig, "admin-order-action", {
          action: "book",
          booking_at: bookingAt,
          ...(data.note ? { note: data.note } : {}),
          order_id: orderId,
        });
        noteAction(`order ${displayId} booked`);
        logic.setState({ fulfillLoading: false, fulfillOpen: false, selectedStep: 4 });
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("order booking failed", error);
        logic.setState({ fulfillError: error.message || "บันทึกนัดหมายไม่สำเร็จ", fulfillLoading: false });
      }
    };

    logic.saveRefProfile = async () => {
      const snapshot = logic.__miraSnapshot || {};
      const tenantId = snapshot.tenant && snapshot.tenant.id;
      const form = logic.state.refForm || {};
      const code = logic.state.refDrawerCode;
      if (!tenantId) {
        logic.setState({ refError: "ต้องโหลด tenant จาก backend ก่อน" });
        return;
      }
      if (!form.name || !String(form.name).trim()) {
        logic.setState({ refError: "กรอกชื่อผู้แนะนำก่อนบันทึก" });
        return;
      }
      if (form.email) {
        noteMissing("Referrer email is visible in the supplied UI, but the production referrers table has no email column.");
      }
      const payload = {
        active: form.status === "active",
        commission_scheme: commissionSchemeFromForm(form),
        name: String(form.name).trim(),
        phone: form.phone ? String(form.phone).trim() : null,
        tenant_id: tenantId,
        type: referrerType(form.type),
      };
      try {
        let saved = null;
        if (code === "__new__") {
          const customCode = String(form.code || "").trim().toUpperCase();
          const rows = await rest(logic.__miraBackendConfig, "referrers?select=id,tenant_id,name,ref_code,type,phone,auth_user_id,commission_scheme,active,created_at", {
            body: {
              ...payload,
              ...(customCode && /^[0-9A-HJKMNP-TV-Z]{6}$/.test(customCode) ? { ref_code: customCode } : {}),
            },
            method: "POST",
            prefer: "return=representation",
          });
          saved = Array.isArray(rows) ? rows[0] : rows;
          noteAction("referrer created");
        } else {
          const referrer = (logic._referrers || []).find((row) => row.code === code);
          if (!referrer || !referrer._rawId) {
            logic.setState({ refError: "ไม่พบ backend row ของผู้แนะนำนี้" });
            return;
          }
          const rows = await rest(logic.__miraBackendConfig, `referrers?id=eq.${referrer._rawId}&tenant_id=eq.${tenantId}&select=id,tenant_id,name,ref_code,type,phone,auth_user_id,commission_scheme,active,created_at`, {
            body: payload,
            method: "PATCH",
            prefer: "return=representation",
          });
          saved = Array.isArray(rows) ? rows[0] : rows;
          noteAction(`referrer ${code} updated`);
        }
        logic.setState({
          refDrawerCode: saved && saved.ref_code ? saved.ref_code : code,
          refError: "",
        });
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("referrer save failed", error);
        logic.setState({ refError: error.message || "บันทึกผู้แนะนำไม่สำเร็จ" });
      }
    };

    logic.saveRefScheme = async () => {
      const snapshot = logic.__miraSnapshot || {};
      const tenantId = snapshot.tenant && snapshot.tenant.id;
      const code = logic.state.refDrawerCode;
      const form = logic.state.refForm || {};
      const referrer = (logic._referrers || []).find((row) => row.code === code);
      if (!tenantId || !referrer || !referrer._rawId) {
        logic.setState({ refError: "ต้องเลือกผู้แนะนำที่มี backend row ก่อน" });
        return;
      }
      try {
        await rest(logic.__miraBackendConfig, `referrers?id=eq.${referrer._rawId}&tenant_id=eq.${tenantId}&select=id`, {
          body: { commission_scheme: commissionSchemeFromForm(form) },
          method: "PATCH",
          prefer: "return=minimal",
        });
        noteAction(`referrer ${code} commission scheme updated`);
        logic.setState({ refError: "" });
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("referrer scheme save failed", error);
        logic.setState({ refError: error.message || "บันทึกสูตรคอมมิชชั่นไม่สำเร็จ" });
      }
    };

    logic.refSetStatus = async (code, status) => {
      const snapshot = logic.__miraSnapshot || {};
      const tenantId = snapshot.tenant && snapshot.tenant.id;
      const referrer = (logic._referrers || []).find((row) => row.code === code);
      if (!tenantId || !referrer || !referrer._rawId) {
        logic.setState({ refError: "ต้องเลือกผู้แนะนำที่มี backend row ก่อน" });
        return;
      }
      try {
        await rest(logic.__miraBackendConfig, `referrers?id=eq.${referrer._rawId}&tenant_id=eq.${tenantId}&select=id`, {
          body: { active: status === "active" },
          method: "PATCH",
          prefer: "return=minimal",
        });
        noteAction(`referrer ${code} ${status}`);
        logic.setState({ refError: "" });
        await refreshFromLogic(logic);
      } catch (error) {
        noteError("referrer status update failed", error);
        logic.setState({ refError: error.message || "อัปเดตสถานะผู้แนะนำไม่สำเร็จ" });
      }
    };

    logic.reopenOrder = () => {
      noteMissing("Reopen needs a protected order state-machine action before it can persist.");
    };

    logic.restoreOrder = () => {
      noteMissing("Restore from archive has no backend action in admin-order-action yet.");
    };
  }

  function patchRenderVals(logic) {
    if (logic.__miraRenderPatched) return;
    const original = logic.renderVals.bind(logic);
    logic.renderVals = function patchedRenderVals() {
      const vals = original();
      const snapshot = this.__miraSnapshot || {};
      const currentReferrer = snapshot.currentReferrer || null;
      const refCode = currentReferrer ? currentReferrer.code : "";
      const refName = currentReferrer ? currentReferrer.name : "ยังไม่มีโปรไฟล์ผู้แนะนำ";
      const refOrders = refCode
        ? (this.state.orders || []).filter((order) => (order.referrer || "").includes(refCode))
        : [];
      const refCommissions = refCode
        ? (this._commissions || []).filter((entry) => entry.code === refCode)
        : [];
      const currentMonth = monthKey(new Date());
      const totalCommission = refCommissions.reduce((sum, entry) => sum + numberValue(entry.amount), 0);
      const monthCommission = refCommissions
        .filter((entry) => monthKey(entry._raw?.created_at) === currentMonth)
        .reduce((sum, entry) => sum + numberValue(entry.amount), 0);
      const refLink = refCode ? `${window.location.origin}/r/${encodeURIComponent(refCode)}` : "";
      const popupRefCode = this.state.qrRef || "";
      const popupRefLink = popupRefCode ? `${window.location.origin}/r/${encodeURIComponent(popupRefCode)}` : "";
      // The design's own playChat resets chatMessages to [] (empty but truthy),
      // so check length too — an empty thread always shows the persona greeting.
      const chatMessages = this.state.chatMessages && this.state.chatMessages.length
        ? this.state.chatMessages
        : [chatPersonaGreeting(this)];
      const activePersonaSlug = chatTenantSlug(this);
      const chatPersonas = CHAT_PERSONAS.map((persona) => {
        const active = persona.slug === activePersonaSlug;
        return {
          chipStyle: [
            "flex:1; padding:7px 10px; border-radius:10px; font-size:12px; font-weight:700; cursor:pointer; transition:all .15s ease;",
            active
              ? "border:1px solid #2563EB; background:#2563EB; color:#fff;"
              : "border:1px solid #E4ECF8; background:#fff; color:#5A6B86;",
          ].join(" "),
          label: persona.label,
          select: () => selectChatPersona(this, persona.slug),
        };
      });
      const chatCards = this.state.chatCards || [];
      const catalogRows = (this._products || [])
        .filter((product) => product.status === "active")
        .map((product) => {
          const meta = this._catMeta ? this._catMeta(product.category) : { bg: "#EAF1FE", fg: "#2563EB", icon: "+" };
          const checkoutProduct = productCheckoutPayload(product);
          const isProduct = checkoutProduct.type === "product";
          return {
            icon: isProduct ? "▦" : meta.icon,
            iconBg: meta.bg,
            iconFg: meta.fg,
            onPick: () => this.rcPick(checkoutProduct),
            price: checkoutProduct.price,
            title: checkoutProduct.title,
            type: isProduct ? "สินค้า" : "บริการ",
          };
        });
      const backendReferralRows = refOrders.map((order) => ({
        amount: order.amount,
        commission: order.commission || "รอคำนวณ",
        custShort: order.custShort || order.customer,
        id: order.id,
        pkg: order.pkg,
        status: order.statusLabel || (order.stage >= 3 ? "ยืนยันแล้ว" : "รอชำระ"),
      }));
      const stateReferralRows = Array.isArray(this.state.rcCreated) ? this.state.rcCreated : [];
      const rcCreatedRows = stateReferralRows.concat(backendReferralRows.filter((row) => !stateReferralRows.some((item) => item.id === row.id)));
      const rcDecoratedRows = rcCreatedRows.map((order) => {
        const meta = ({
          "รอชำระ": { bg: "#FDF1DE", fg: "#C9810A" },
          "ยืนยันแล้ว": { bg: "#EAF1FE", fg: "#2563EB" },
          "เสร็จสิ้น": { bg: "rgba(16,185,129,.12)", fg: "#0F9D70" },
        })[order.status] || { bg: "#F1F5F9", fg: "#64748B" };
        return { ...order, statusBg: meta.bg, statusFg: meta.fg };
      });

      return {
        ...vals,
        chatInputVal: this.state.chatInput || "",
        chatHasLiveCards: chatCards.length > 0,
        chatLiveCards: chatCards,
        chatLiveLoading: Boolean(this.state.chatLoading),
        chatLiveMessages: chatMessages,
        chatPersonas,
        chatPay: () => noteMissing("Payment upload/checkout needs the real order panel UI contract in this supplied chat screen."),
        csCards: false,
        csGreet: false,
        csOrder: false,
        csPaid: false,
        csPay: false,
        csRecommend: false,
        csTyping: false,
        csUserPick: false,
        csUserQ: false,
        onChatInput: (event) => this.setState({ chatInput: event.target.value }),
        onChatKey: (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.sendChat && this.sendChat();
          }
        },
        replayChat: () => this.setState({ chatCards: [], chatInput: "", chatLoading: false, chatMessages: [chatPersonaGreeting(this)], chatSessionId: null }),
        sendChat: this.sendChat,
        takeOver: async () => {
          const conversation = selectedConversation(this);
          if (!conversation || !conversation._rawId) return;
          try {
            await invokeFunction(this.__miraBackendConfig, "admin-line-reply", { action: "set_mode", agent_mode: "human", session_id: conversation._rawId });
            await refreshFromLogic(this);
          } catch (error) {
            noteError("conversation takeover failed", error);
          }
        },
        returnAI: async () => {
          const conversation = selectedConversation(this);
          if (!conversation || !conversation._rawId) return;
          try {
            await invokeFunction(this.__miraBackendConfig, "admin-line-reply", { action: "set_mode", agent_mode: "ai", session_id: conversation._rawId });
            await refreshFromLogic(this);
          } catch (error) {
            noteError("conversation return AI failed", error);
          }
        },
        refDisplayName: refName,
        refInitial: refName.trim().charAt(0) || "-",
        refMonthComm: baht(monthCommission),
        refMyCode: refCode || "-",
        refMyLink: refLink || "-",
        refOrderCount: refOrders.length,
        refOrders: refOrders.map((order) => ({
          amount: order.amount,
          commission: order.commission,
          custShort: order.custShort || order.customer,
          id: order.id,
          pkg: order.pkg,
          statusBg: order.statusBg || "#F1F5F9",
          statusFg: order.statusFg || "#64748B",
          statusLabel: order.statusLabel || "-",
        })),
        refQrImageUrl: qrImageUrl(refLink, 188),
        refQrCells: this._qrCells(refLink || "no-referrer-profile"),
        refTotalComm: baht(totalCommission),
        qrImageUrl: qrImageUrl(popupRefLink, 222),
        qrLink: popupRefLink || "-",
        coRefCode: refCode || "-",
        rcCatalogRows: catalogRows,
        rcCreatedCount: rcDecoratedRows.length,
        rcCreatedRows: rcDecoratedRows,
        rcHasCreated: rcDecoratedRows.length > 0,
        rcRefCode: refCode || "-",
        canRegister: false,
        loginHelpText: "ใช้บัญชีจริงที่มีสิทธิ์ใน tenant เท่านั้น",
        saveProductForm: this.saveProductForm,
      };
    };
    logic.__miraRenderPatched = true;
  }

  function mapChatCards(cards, products, logic) {
    const cardList = Array.isArray(cards) ? cards : [];
    // Category browse card ([[categories]] marker / browse_categories action):
    // render each category as a tappable card that asks the backend for the
    // products in that category (browse_category action).
    const categoryEntries = cardList
      .filter((card) => card && card.type === "category_grid" && Array.isArray(card.categories))
      .flatMap((card) => card.categories)
      .slice(0, 6)
      .map((cat) => ({
        cta: "ดูรายการในหมวดนี้",
        description: cat.product_count != null ? `${cat.product_count} รายการ` : "",
        openCheckout: () => {
          if (logic && logic.sendChatAction) {
            logic.sendChatAction({ category: cat.key, type: "browse_category" }, `ขอดูหมวด ${cat.label_th || cat.key}`);
          } else {
            noteMissing("Category browse needs the backend adapter to be ready.");
          }
        },
        price: "",
        title: `${cat.icon || "▦"} ${cat.label_th || cat.key}`,
      }));
    if (categoryEntries.length) return categoryEntries;
    const fromCards = cardList.flatMap((card) => Array.isArray(card.products) ? card.products : Array.isArray(card.items) ? card.items : []);
    const source = fromCards.length ? fromCards : products || [];
    return source.slice(0, 6).map((item) => {
      const product = productCheckoutPayload({
        _catalogKey: item.catalog_key || item.catalogKey || "",
        branches: item.branches || [],
        category: item.category,
        desc: item.description || item.subtitle || "",
        includes: item.includes || [],
        name: item.name,
        price: item.price_baht != null ? baht(item.price_baht) : item.price || "",
        title: item.title,
        type: item.category === "product" || item.type === "product" ? "product" : "service",
      });
      return {
        cta: "เลือกรายการนี้",
        description: compact(product.sub || item.category, ""),
        openCheckout: () => {
          if (logic && logic.openBackendCheckout) {
            logic.openBackendCheckout(product);
          } else {
            noteMissing("Checkout action needs the backend adapter to be ready.");
          }
        },
        price: product.price,
        title: product.title,
      };
    });
  }

  // Playground personas: the same chat engine serves any tenant, so the picker
  // just swaps the tenant_slug (and starts a fresh session) per brand.
  const CHAT_PERSONAS = [
    {
      greeting: "สวัสดีค่ะ 👋 Mira ผู้ช่วยขายของโรงพยาบาลค่ะ สนใจแพ็กเกจตรวจสุขภาพหรือวัคซีน พิมพ์ถามได้เลยค่ะ",
      label: "🏥 โรงพยาบาล",
      slug: "demo-hospital",
    },
    {
      greeting: "สวัสดีค่ะ 👋 Mira ผู้ช่วยขายน้ำโปรตีนใส ClearPro ค่ะ สนใจรสไหนหรืออยากได้แบบแพ็ก สอบถามได้เลยค่ะ",
      label: "🥤 น้ำโปรตีนใส",
      slug: "demo-protein",
    },
  ];

  function chatTenantSlug(logic) {
    if (logic.state && logic.state.chatTenantSlug) return logic.state.chatTenantSlug;
    const config = logic.__miraBackendConfig || window.MIRA_BACKEND_CONFIG || {};
    return config.tenantSlug || "demo-hospital";
  }

  function chatPersonaGreeting(logic) {
    const persona = CHAT_PERSONAS.find((entry) => entry.slug === chatTenantSlug(logic));
    return messageBubble("mira", persona ? persona.greeting : "เชื่อมต่อ AI backend แล้ว พิมพ์ข้อความเพื่อถาม Mira ได้เลย");
  }

  function selectChatPersona(logic, slug) {
    if (chatTenantSlug(logic) === slug) return;
    const persona = CHAT_PERSONAS.find((entry) => entry.slug === slug);
    logic.setState({
      chatCards: [],
      chatInput: "",
      chatLoading: false,
      chatMessages: [messageBubble("mira", persona ? persona.greeting : "เริ่มบทสนทนาใหม่แล้ว พิมพ์ข้อความเพื่อให้ AI ตอบจาก backend จริง")],
      chatSessionId: null,
      chatTenantSlug: slug,
    });
  }

  function patchChat(logic) {
    if (logic.__miraChatPatched) return;
    const deliverChatTurn = async (payload, echoLabel) => {
      if (logic.state.chatLoading) return;
      const personaAtSend = chatTenantSlug(logic);
      const currentMessages = logic.state.chatMessages || [];
      logic.setState({
        chatCards: [],
        chatInput: "",
        chatLoading: true,
        chatMessages: echoLabel ? [...currentMessages, messageBubble("me", echoLabel)] : currentMessages,
      });
      try {
        const config = await ensureDemoAuth(logic);
        const response = await invokeFunction(config, "chat-orchestrator", {
          client_msg_id: crypto.randomUUID(),
          channel: "app",
          session_id: logic.state.chatSessionId || null,
          tenant_slug: personaAtSend,
          ...payload,
        }, { allowAnon: true });
        logic.setState((state) => {
          // The presenter switched persona while this turn was in flight: the
          // reply belongs to the previous brand's session, so drop it.
          if (chatTenantSlug(logic) !== personaAtSend) return {};
          const answer = compact(response && response.text, "");
          return {
            chatCards: mapChatCards(response && response.cards, response && response.products, logic),
            chatLoading: false,
            chatMessages: answer
              ? [...(state.chatMessages || []), messageBubble("mira", answer)]
              : (state.chatMessages || []),
            chatSessionId: response && response.session_id ? response.session_id : state.chatSessionId,
          };
        });
      } catch (error) {
        noteError("AI chat failed", error);
        logic.setState((state) => {
          if (chatTenantSlug(logic) !== personaAtSend) return {};
          return {
            chatLoading: false,
            chatMessages: [...(state.chatMessages || []), messageBubble("mira", `AI backend error: ${error.message || error}`)],
          };
        });
      }
    };
    logic.sendChat = async () => {
      const text = compact(logic.state.chatInput, "");
      if (!text) return;
      await deliverChatTurn({ action: null, message: text }, text);
    };
    logic.sendChatAction = async (action, echoLabel) => {
      if (!action) return;
      // orchestrateChat rejects most actions without a message, so mirror the
      // RN app (PrototypeChatPanel) and send the echo label as the message.
      await deliverChatTurn({ action, message: echoLabel || "" }, echoLabel || "");
    };
    logic.__miraChatPatched = true;
  }

  function applySnapshot(logic, snapshot) {
    logic._branches = snapshot.branches;
    logic._commissions = snapshot.commissions;
    logic._conversations = snapshot.conversations;
    logic._line = snapshot.line;
    logic._payments = snapshot.payments;
    logic._products = snapshot.products;
    logic._referrers = snapshot.referrers;
    logic._chatProducts = Object.fromEntries(
      snapshot.products.map((product, index) => [product._catalogKey || product._rawId || `product-${index}`, productCheckoutPayload(product)]),
    );
    logic.__miraSnapshot = snapshot;

    logic.setState({
      accountName: snapshot.tenant.display_name || "ทีมแอดมิน",
      dataState: "normal",
      lineConn: snapshot.line && snapshot.line.verified ? "connected" : "missing",
      loggedIn: true,
      orders: snapshot.orders,
      role: snapshot.currentReferrer && !snapshot.membershipRole ? "referral" : "admin",
      showLogin: false,
      stockBook: {},
    });

    STATUS.instance = true;
    STATUS.lastSyncAt = new Date().toISOString();
    setMode("backend");
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

  async function boot(inputConfig, options = {}) {
    let config = mergeStoredSession(inputConfig);
    if (!config || !config.backendReady || !config.supabaseUrl || !config.supabaseAnonKey) {
      const logic = await waitForLogic();
      resetDesignData(logic, { dataState: "error", loggedIn: false, showLogin: false });
      noteMissing("Supabase public config was not provided by the host app.");
      setMode("config-missing");
      return;
    }

    const nextSignature = JSON.stringify({
      accessToken: config.accessToken ? "token" : "",
      supabaseAnonKey: config.supabaseAnonKey,
      supabaseUrl: config.supabaseUrl,
      tenantSlug: config.tenantSlug,
      userEmail: config.userEmail,
    });

    if (!options.force && bootPromise && bootSignature === nextSignature) {
      return bootPromise;
    }

    bootSignature = nextSignature;
    STATUS.config = true;
    window.MIRA_BACKEND_CONFIG = config;
    bootPromise = (async () => {
      const logic = await waitForLogic();
      patchActions(logic, config, async () => {
        const snapshot = await loadSnapshot(logic.__miraBackendConfig || config);
        applySnapshot(logic, snapshot);
      });
      patchChat(logic);

      if (!config.accessToken) {
        resetDesignData(logic, { dataState: "empty", loggedIn: false, showLogin: true });
        setMode("auth-required");
        return;
      }

      try {
        logic.setState({ dataState: "loading" });
        const snapshot = await loadSnapshot(config);
        applySnapshot(logic, snapshot);
      } catch (error) {
        resetDesignData(logic, { dataState: "error", loggedIn: false, showLogin: true });
        noteError("Initial backend sync failed.", error);
        setMode("error");
      }
    })();

    return bootPromise;
  }

  function activeConfig() {
    return window.MIRA_BACKEND_CONFIG || getConfigFromQuery();
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
