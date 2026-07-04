(function initMentorMessaging() {
  const MAX_BODY = 2000;

  function sb() {
    return window.getSupabase?.() || window.sb;
  }

  function sec() {
    return window.RekabetliSecurity;
  }

  function vitrin() {
    return window.RekabetliMentorVitrin;
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("tr-TR", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function formatPrice(price) {
    if (vitrin()?.formatPriceTry) return vitrin().formatPriceTry(price) || "—";
    if (price == null) return "—";
    return String(price);
  }

  function requestStatusLabel(status) {
    const map = {
      pending: "Beklemede",
      reviewing: "İnceleniyor",
      contacted: "İletişim kuruldu",
      rejected: "Reddedildi",
    };
    return map[status] || status || "—";
  }

  function sanitizeBody(raw) {
    const security = sec();
    if (security?.containsMarkupAttempt?.(raw)) {
      return { error: "HTML, script veya geçersiz bağlantı içeriği kullanılamaz." };
    }
    const body = security?.sanitizePlainText
      ? security.sanitizePlainText(raw, MAX_BODY)
      : String(raw || "").trim().slice(0, MAX_BODY);
    if (!body) return { error: "Mesaj boş olamaz." };
    return { body };
  }

  function displayNameFromProfile(profile, fallback = "Kullanıcı") {
    const name = securityName(profile?.display_name, fallback);
    return name || fallback;
  }

  function securityName(value, fallback) {
    const security = sec();
    if (security?.sanitizePersonName) {
      return security.sanitizePersonName(value, 120) || fallback;
    }
    return String(value || "").trim().slice(0, 120) || fallback;
  }

  function buildMentorLoginRedirect(mentorId) {
    const safeId = parseUuidParam(mentorId);
    if (!safeId) return "/mentors";
    const params = new URLSearchParams();
    params.set("id", safeId);
    params.set("openMessaging", "1");
    return `/mentor?${params.toString()}`;
  }

  function parseUuidParam(value) {
    const id = String(value ?? "").trim();
    if (sec()?.isValidUuid?.(id)) return id;
    if (vitrin()?.isValidMentorId?.(id)) return id;
    return "";
  }

  function parseInboxDeepLink(search = window.location.search) {
    const params = new URLSearchParams(search);
    const inbox = params.get("inbox");
    return {
      inbox: inbox === "messages" || inbox === "requests" ? inbox : null,
      requestId: parseUuidParam(params.get("request")),
      conversationId: parseUuidParam(params.get("conversation")),
      messageId: parseUuidParam(params.get("message")),
    };
  }

  function parseStudentMessagingDeepLink(search = window.location.search) {
    const params = new URLSearchParams(search);
    return {
      openMessaging: params.get("openMessaging") === "1",
      conversationId: parseUuidParam(params.get("conversation")),
      messageId: parseUuidParam(params.get("message")),
    };
  }

  function cleanUrlParams(keys) {
    const params = new URLSearchParams(window.location.search);
    keys.forEach((key) => params.delete(key));
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  }

  function applyHighlightScroll(element) {
    if (!element) return;
    element.classList.add("is-highlighted");
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => element.classList.remove("is-highlighted"), 3200);
  }

  async function getSessionUser() {
    const supabase = sb();
    if (!supabase) return null;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user ?? null;
  }

  async function getOrCreateConversation(mentorId, studentId) {
    const supabase = sb();
    const { data: existing, error: findError } = await supabase
      .from("mentor_conversations")
      .select("id")
      .eq("mentor_id", mentorId)
      .eq("student_id", studentId)
      .maybeSingle();

    if (findError) throw findError;
    if (existing?.id) return existing.id;

    const { data: created, error: insertError } = await supabase
      .from("mentor_conversations")
      .insert({ mentor_id: mentorId, student_id: studentId })
      .select("id")
      .single();

    if (insertError) throw insertError;
    return created.id;
  }

  async function fetchConversationMessages(conversationId) {
    const supabase = sb();
    const { data, error } = await supabase
      .from("mentor_messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data ?? [];
  }

  async function sendMessage({ conversationId, mentorId, studentId, body }) {
    const supabase = sb();
    const user = await getSessionUser();
    if (!user) return { error: "login" };

    let convId = conversationId;
    if (!convId) {
      if (!mentorId || !studentId || studentId !== user.id) {
        return { error: "Konuşma başlatılamadı." };
      }
      try {
        convId = await getOrCreateConversation(mentorId, studentId);
      } catch (error) {
        console.error("mentor conversation:", error.message);
        return { error: "Mesaj gönderilemedi." };
      }
    }

    const { error } = await supabase.from("mentor_messages").insert({
      conversation_id: convId,
      sender_id: user.id,
      body,
    });

    if (error) {
      console.error("mentor message:", error.message);
      return { error: "Mesaj gönderilemedi." };
    }

    window.rekabetliNotifications?.refresh?.();
    return { conversationId: convId };
  }

  function renderMessageList(container, messages, currentUserId, labels = {}) {
    container.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "mentor-msg-empty";
      empty.textContent = labels.empty || "Henüz mesaj yok. İlk sorunuzu yazın.";
      container.appendChild(empty);
      return;
    }

    messages.forEach((msg) => {
      const isOwn = msg.sender_id === currentUserId;
      const bubble = document.createElement("div");
      bubble.className = `mentor-msg-bubble${isOwn ? " mentor-msg-bubble--own" : " mentor-msg-bubble--other"}`;
      if (msg.id) bubble.dataset.messageId = msg.id;

      const meta = document.createElement("p");
      meta.className = "mentor-msg-meta";
      const who = isOwn ? labels.ownLabel || "Siz" : labels.otherLabel || "Mentör";
      meta.textContent = `${who} · ${formatDate(msg.created_at)}`;

      const body = document.createElement("p");
      body.className = "mentor-msg-body";
      body.textContent = msg.body;

      bubble.append(meta, body);
      container.appendChild(bubble);
    });
    container.scrollTop = container.scrollHeight;
  }

  function createComposeForm({ placeholder, submitLabel, onSubmit }) {
    const form = document.createElement("form");
    form.className = "mentor-msg-compose";

    const textarea = document.createElement("textarea");
    textarea.className = "mentor-msg-input";
    textarea.rows = 3;
    textarea.maxLength = MAX_BODY;
    textarea.placeholder = placeholder;
    textarea.required = true;

    const actions = document.createElement("div");
    actions.className = "mentor-msg-compose-actions";

    const hint = document.createElement("p");
    hint.className = "profile-hint mentor-msg-hint";
    hint.textContent = `En fazla ${MAX_BODY} karakter. Düz metin kullanın.`;

    const message = document.createElement("p");
    message.className = "form-message mentor-msg-form-message";
    message.hidden = true;
    message.setAttribute("role", "status");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = submitLabel;

    actions.appendChild(submit);
    form.append(textarea, hint, message, actions);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.hidden = true;
      const parsed = sanitizeBody(textarea.value);
      if (parsed.error) {
        message.hidden = false;
        message.textContent = parsed.error;
        message.classList.add("is-error");
        return;
      }

      submit.disabled = true;
      const result = await onSubmit(parsed.body);
      submit.disabled = false;

      if (result?.error === "login") {
        window.location.href = `/login?redirect=${encodeURIComponent(result.redirect || "/mentors")}`;
        return;
      }
      if (result?.error) {
        message.hidden = false;
        message.textContent = result.error;
        message.classList.add("is-error");
        return;
      }

      textarea.value = "";
      message.hidden = false;
      message.textContent = result?.successMessage || "Gönderildi.";
      message.classList.remove("is-error");
    });

    return { form, textarea, message };
  }

  async function mountStudentPanel({ root, mentorId, mentorName, deepLink = null }) {
    if (!root || !vitrin()?.isValidMentorId?.(mentorId)) return;

    root.replaceChildren();
    root.classList.add("mentor-student-messaging");

    const intro = document.createElement("p");
    intro.className = "profile-hint mentor-msg-intro";
    intro.textContent =
      "Mentöre doğrudan soru sorun. Yanıtlar yalnızca siz ve mentör tarafından görülür.";
    root.appendChild(intro);

    const user = await getSessionUser();
    if (!user) {
      const loginBox = document.createElement("div");
      loginBox.className = "mentor-msg-login-prompt";
      const text = document.createElement("p");
      text.textContent = "Soru sormak için giriş yapmanız gerekir.";
      const link = document.createElement("a");
      link.className = "mentor-msg-login-btn";
      link.href = `/login?redirect=${encodeURIComponent(buildMentorLoginRedirect(mentorId))}`;
      link.textContent = "Giriş yap";
      loginBox.append(text, link);
      root.appendChild(loginBox);
      return;
    }

    if (user.id === mentorId) {
      const own = document.createElement("p");
      own.className = "profile-hint";
      own.textContent = "Bu sizin profiliniz. Gelen mesajları ";
      const link = document.createElement("a");
      link.href = "/mentor-sayfam";
      link.textContent = "Mentör sayfam";
      own.appendChild(link);
      own.append(" üzerinden yönetebilirsiniz.");
      root.appendChild(own);
      return;
    }

    const thread = document.createElement("div");
    thread.className = "mentor-msg-thread";

    const list = document.createElement("div");
    list.className = "mentor-msg-list";
    list.setAttribute("aria-live", "polite");
    thread.appendChild(list);

    let conversationId = null;

    async function refresh() {
      const supabase = sb();
      const { data: conv } = await supabase
        .from("mentor_conversations")
        .select("id")
        .eq("mentor_id", mentorId)
        .eq("student_id", user.id)
        .maybeSingle();

      conversationId = conv?.id ?? null;
      if (!conversationId) {
        renderMessageList(list, [], user.id, {
          empty: "Henüz mesaj yok. Aşağıdan ilk sorunuzu yazın.",
          otherLabel: mentorName || "Mentör",
        });
        return;
      }

      const messages = await fetchConversationMessages(conversationId);
      renderMessageList(list, messages, user.id, {
        otherLabel: mentorName || "Mentör",
      });

      if (deepLink?.messageId) {
        const msgEl = list.querySelector(
          `[data-message-id="${CSS.escape(deepLink.messageId)}"]`,
        );
        applyHighlightScroll(msgEl);
      } else {
        list.scrollTop = list.scrollHeight;
      }
    }

    const { form } = createComposeForm({
      placeholder: "Mentöre sormak istediğiniz konuyu yazın…",
      submitLabel: "Gönder",
      onSubmit: async (body) => {
        const result = await sendMessage({
          conversationId,
          mentorId,
          studentId: user.id,
          body,
        });
        if (result.error) return result;
        conversationId = result.conversationId;
        await refresh();
        return { successMessage: "Mesajınız iletildi." };
      },
    });

    thread.appendChild(form);
    root.appendChild(thread);

    await refresh();

    if (deepLink?.openMessaging || deepLink?.messageId) {
      document.getElementById("mentor-messages-title")?.scrollIntoView({ behavior: "smooth" });
      cleanUrlParams(["conversation", "message"]);
    }
  }

  function createTabButton(label, isActive, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `mentor-inbox-tab${isActive ? " is-active" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function renderPackageRequests(panel, requests) {
    panel.replaceChildren();
    if (!requests.length) {
      const empty = document.createElement("p");
      empty.className = "mentor-inbox-empty";
      empty.textContent = "Henüz paket ön talebi yok.";
      panel.appendChild(empty);
      return;
    }

    requests.forEach((row) => {
      const card = document.createElement("article");
      card.className = "mentor-inbox-request-card";
      if (row.id) card.dataset.requestId = row.id;

      const head = document.createElement("header");
      head.className = "mentor-inbox-request-head";

      const title = document.createElement("h3");
      title.className = "mentor-inbox-request-title";
      title.textContent = row.package_title || "Paket";

      const status = document.createElement("span");
      status.className = `mentor-inbox-status mentor-inbox-status--${row.status || "pending"}`;
      status.textContent = requestStatusLabel(row.status);

      head.append(title, status);

      const meta = document.createElement("p");
      meta.className = "mentor-inbox-request-meta";
      const studentName = `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Öğrenci";
      meta.textContent = `${studentName} · ${formatDate(row.created_at)}`;

      const details = document.createElement("dl");
      details.className = "mentor-inbox-request-details";

      const addDetail = (label, value) => {
        if (!value) return;
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        details.append(dt, dd);
      };

      addDetail("E-posta", row.email);
      addDetail("Telefon", row.phone);
      addDetail("Liste fiyatı", formatPrice(row.package_price));
      addDetail("Not", row.note);

      card.append(head, meta, details);
      panel.appendChild(card);
    });
  }

  function applyMentorInboxDeepLink({
    deepLink,
    showTab,
    requestsPanel,
    messagesPanel,
    inboxTitleEl,
    openAccordionThread,
  }) {
    if (!deepLink) return;

    if (deepLink.inbox === "messages") {
      showTab("messages");
    } else if (deepLink.inbox === "requests") {
      showTab("requests");
    }

    if (deepLink.requestId && requestsPanel) {
      showTab("requests");
      const card = requestsPanel.querySelector(
        `[data-request-id="${CSS.escape(deepLink.requestId)}"]`,
      );
      applyHighlightScroll(card);
    }

    if (deepLink.conversationId && openAccordionThread) {
      showTab("messages");
      openAccordionThread(deepLink.conversationId, {
        highlightThread: true,
        messageId: deepLink.messageId,
      });
    }

    inboxTitleEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    cleanUrlParams(["inbox", "request", "conversation", "message"]);
  }

  function createStudentMessageAccordion(messagesPanel) {
    const accordion = document.createElement("div");
    accordion.className = "mentor-inbox-accordion";
    accordion.setAttribute("role", "presentation");
    messagesPanel.appendChild(accordion);

    const entries = new Map();

    function setThreadOpen(conversationId, isOpen) {
      const entry = entries.get(conversationId);
      if (!entry) return;
      entry.body.hidden = !isOpen;
      entry.headBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      entry.thread.classList.toggle("mentor-inbox-thread--open", isOpen);
      if (entry.bodyId) {
        entry.headBtn.setAttribute("aria-controls", entry.bodyId);
      }
    }

    function closeAll() {
      entries.forEach((_, id) => setThreadOpen(id, false));
    }

    function openThread(conversationId, options = {}) {
      const entry = entries.get(conversationId);
      if (!entry) return;
      closeAll();
      setThreadOpen(conversationId, true);
      if (options.highlightThread) applyHighlightScroll(entry.thread);
      if (options.messageId) {
        const msgEl = entry.thread.querySelector(
          `[data-message-id="${CSS.escape(options.messageId)}"]`,
        );
        applyHighlightScroll(msgEl);
      }
      entry.list.scrollTop = entry.list.scrollHeight;
    }

    function toggleThread(conversationId) {
      const entry = entries.get(conversationId);
      if (!entry) return;
      if (!entry.body.hidden) {
        setThreadOpen(conversationId, false);
        return;
      }
      openThread(conversationId);
    }

    function registerThread(conversationId, parts) {
      entries.set(conversationId, parts);
    }

    return { accordion, registerThread, openThread, toggleThread };
  }

  async function mountMentorInbox({ root, mentorId, deepLink = null }) {
    if (!root || !vitrin()?.isValidMentorId?.(mentorId)) return;

    root.replaceChildren();
    root.classList.add("mentor-inbox");

    const tabs = document.createElement("div");
    tabs.className = "mentor-inbox-tabs";
    tabs.setAttribute("role", "tablist");

    const requestsPanel = document.createElement("div");
    requestsPanel.className = "mentor-inbox-panel";
    requestsPanel.id = "mentor-inbox-requests";
    requestsPanel.setAttribute("role", "tabpanel");

    const messagesPanel = document.createElement("div");
    messagesPanel.className = "mentor-inbox-panel";
    messagesPanel.id = "mentor-inbox-messages";
    messagesPanel.hidden = true;
    messagesPanel.setAttribute("role", "tabpanel");

    let accordionApi = null;

    const finishInboxMount = () => {
      applyMentorInboxDeepLink({
        deepLink,
        showTab,
        requestsPanel,
        messagesPanel,
        inboxTitleEl: document.getElementById("mentor-inbox-title"),
        openAccordionThread: accordionApi?.openThread,
      });
    };

    const showTab = (name) => {
      requestsPanel.hidden = name !== "requests";
      messagesPanel.hidden = name !== "messages";
      tabs.querySelectorAll(".mentor-inbox-tab").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.tab === name);
      });
    };

    const requestsTab = createTabButton("Ön talepler", true, () => showTab("requests"));
    requestsTab.dataset.tab = "requests";
    const messagesTab = createTabButton("Mesajlar", false, () => showTab("messages"));
    messagesTab.dataset.tab = "messages";
    tabs.append(requestsTab, messagesTab);

    root.append(tabs, requestsPanel, messagesPanel);

    const supabase = sb();
    const [{ data: requests, error: reqError }, { data: convos, error: convError }] =
      await Promise.all([
        supabase
          .from("package_requests")
          .select(
            "id, package_title, package_price, first_name, last_name, email, phone, note, status, created_at",
          )
          .eq("mentor_id", mentorId)
          .order("created_at", { ascending: false }),
        supabase
          .from("mentor_conversations")
          .select("id, student_id, updated_at")
          .eq("mentor_id", mentorId)
          .order("updated_at", { ascending: false }),
      ]);

    if (reqError) console.error("mentor inbox requests:", reqError.message);
    renderPackageRequests(requestsPanel, requests ?? []);

    if (convError) {
      console.error("mentor inbox conversations:", convError.message);
      const err = document.createElement("p");
      err.className = "mentor-inbox-empty";
      err.textContent = "Mesajlar yüklenemedi.";
      messagesPanel.appendChild(err);
      finishInboxMount();
      return;
    }

    const conversations = convos ?? [];
    if (!conversations.length) {
      const empty = document.createElement("p");
      empty.className = "mentor-inbox-empty";
      empty.textContent = "Henüz öğrenci mesajı yok.";
      messagesPanel.appendChild(empty);
      finishInboxMount();
      return;
    }

    const studentIds = [...new Set(conversations.map((c) => c.student_id))];
    const convoIds = conversations.map((c) => c.id);

    const [{ data: profiles }, { data: allMessages, error: msgError }] = await Promise.all([
      supabase.from("profiles").select("id, display_name").in("id", studentIds),
      supabase
        .from("mentor_messages")
        .select("id, conversation_id, sender_id, body, created_at")
        .in("conversation_id", convoIds)
        .order("created_at", { ascending: true }),
    ]);

    if (msgError) {
      console.error("mentor inbox messages:", msgError.message);
      messagesPanel.appendChild(
        Object.assign(document.createElement("p"), {
          className: "mentor-inbox-empty",
          textContent: "Mesajlar yüklenemedi.",
        }),
      );
      finishInboxMount();
      return;
    }

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    const messagesByConvo = new Map();
    (allMessages ?? []).forEach((msg) => {
      const list = messagesByConvo.get(msg.conversation_id) ?? [];
      list.push(msg);
      messagesByConvo.set(msg.conversation_id, list);
    });

    const user = await getSessionUser();
    accordionApi = createStudentMessageAccordion(messagesPanel);

    conversations.forEach((convo, index) => {
      const student = profileById.get(convo.student_id);
      const studentName = displayNameFromProfile(student, "Öğrenci");
      const messages = messagesByConvo.get(convo.id) ?? [];
      const last = messages[messages.length - 1];
      const preview = last?.body
        ? `${last.body.slice(0, 120)}${last.body.length > 120 ? "…" : ""}`
        : "Henüz mesaj yok";

      const thread = document.createElement("article");
      thread.className = "mentor-inbox-thread";
      thread.dataset.conversationId = convo.id;

      const headBtn = document.createElement("button");
      headBtn.type = "button";
      headBtn.className = "mentor-inbox-thread-head";
      headBtn.setAttribute("aria-expanded", "false");
      headBtn.id = `mentor-thread-head-${convo.id}`;

      const headRow = document.createElement("span");
      headRow.className = "mentor-inbox-thread-head-row";

      const headTitle = document.createElement("span");
      headTitle.className = "mentor-inbox-thread-name";
      headTitle.textContent = studentName;

      const chevron = document.createElement("span");
      chevron.className = "mentor-inbox-thread-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "▾";

      headRow.append(headTitle, chevron);

      const headPreview = document.createElement("span");
      headPreview.className = "mentor-inbox-thread-preview";
      headPreview.textContent = preview;

      const headMeta = document.createElement("span");
      headMeta.className = "mentor-inbox-thread-meta";
      headMeta.textContent = formatDate(last?.created_at || convo.updated_at);

      headBtn.append(headRow, headPreview, headMeta);

      const body = document.createElement("div");
      body.className = "mentor-inbox-thread-body";
      body.id = `mentor-thread-body-${convo.id}`;
      body.hidden = true;
      body.setAttribute("role", "region");
      body.setAttribute("aria-labelledby", headBtn.id);

      const list = document.createElement("div");
      list.className = "mentor-msg-list";

      renderMessageList(list, messages, user?.id, {
        ownLabel: "Siz",
        otherLabel: studentName,
        empty: "Henüz mesaj yok.",
      });

      const { form } = createComposeForm({
        placeholder: `${studentName} için yanıt yazın…`,
        submitLabel: "Yanıtla",
        onSubmit: async (text) => {
          const result = await sendMessage({
            conversationId: convo.id,
            body: text,
          });
          if (result.error) return result;
          const refreshed = await fetchConversationMessages(convo.id);
          renderMessageList(list, refreshed, user?.id, {
            ownLabel: "Siz",
            otherLabel: studentName,
          });
          const newLast = refreshed[refreshed.length - 1];
          headPreview.textContent = newLast?.body
            ? `${newLast.body.slice(0, 120)}${newLast.body.length > 120 ? "…" : ""}`
            : preview;
          headMeta.textContent = formatDate(newLast?.created_at || convo.updated_at);
          list.scrollTop = list.scrollHeight;
          return { successMessage: "Yanıt gönderildi." };
        },
      });

      headBtn.addEventListener("click", () => {
        accordionApi.toggleThread(convo.id);
        if (!body.hidden) list.scrollTop = list.scrollHeight;
      });

      body.append(list, form);
      thread.append(headBtn, body);
      accordionApi.accordion.appendChild(thread);

      accordionApi.registerThread(convo.id, {
        thread,
        headBtn,
        body,
        list,
        bodyId: body.id,
      });

      if (index === 0 && !deepLink?.conversationId) {
        accordionApi.openThread(convo.id);
      }
    });

    finishInboxMount();
  }

  async function mountPackagePanel({ root, mentorId, packageId, packageTitle, deepLink = null }) {
    if (!root || !vitrin()?.isValidMentorId?.(mentorId)) return;

    const safePackageId = sec()?.sanitizePackageId?.(packageId) || "";
    if (!safePackageId) return;

    root.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "mentor-inbox-empty";
    loading.textContent = "Yükleniyor…";
    root.appendChild(loading);

    const { data, error } = await sb()
      .from("package_requests")
      .select(
        "id, package_id, package_title, package_price, first_name, last_name, email, phone, note, status, created_at",
      )
      .eq("mentor_id", mentorId)
      .eq("package_id", safePackageId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("mentor package panel:", error.message);
      root.replaceChildren();
      const err = document.createElement("p");
      err.className = "mentor-inbox-empty";
      err.textContent = "Ön talepler yüklenemedi.";
      root.appendChild(err);
      return;
    }

    const requests = (data ?? []).map((row) => ({
      ...row,
      package_title: row.package_title || packageTitle || "Paket",
    }));
    renderPackageRequests(root, requests);

    if (deepLink?.requestId) {
      const card = root.querySelector(`[data-request-id="${CSS.escape(deepLink.requestId)}"]`);
      applyHighlightScroll(card);
      cleanUrlParams(["inbox", "request"]);
    }
  }

  window.RekabetliMentorMessaging = {
    mountStudentPanel,
    mountMentorInbox,
    mountPackagePanel,
    parseInboxDeepLink,
    parseStudentMessagingDeepLink,
  };
})();
