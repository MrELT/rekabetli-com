(function initMentorMessaging() {
  function getEnrollmentAccessStatus(row) {
    if (!row) return "active";
    if (row.order_status === "refunded" || row.unenrolled_at) return "refunded";
    if (row.refund_requested_at) return "refund_pending";
    return "active";
  }

  function getEnrollmentStatusLabel(row) {
    const status = getEnrollmentAccessStatus(row);
    if (status === "refunded") return "İade edildi";
    if (status === "refund_pending") return "İade talebi alındı";
    return "";
  }

  function renderRefundedEnrollmentNotice(root, {
    title,
    subtitle,
    refundedAt = null,
  }) {
    root.replaceChildren();

    const panel = document.createElement("div");
    panel.className = "enrollment-refunded-panel";

    const badge = document.createElement("p");
    badge.className = "enrollment-status-badge enrollment-status-badge--refunded enrollment-status-badge--large";
    badge.textContent = "İade edildi";

    const heading = document.createElement("h2");
    heading.className = "enrollment-refunded-title";
    heading.textContent = title;

    const copy = document.createElement("p");
    copy.className = "profile-hint enrollment-refunded-copy";
    copy.textContent =
      subtitle
      || "Bu öğrenci için paket iadesi tamamlandı. Paket erişimi kapatıldı; mesaj ve görüşme planlama kullanılamaz.";

    panel.append(badge, heading, copy);

    if (refundedAt) {
      const when = document.createElement("p");
      when.className = "profile-hint enrollment-refunded-meta";
      when.textContent = `İade tarihi: ${formatDate(refundedAt)}`;
      panel.appendChild(when);
    }

    root.appendChild(panel);
  }

  const MAX_BODY = 2000;
  const MAX_RICH_BODY = 12000;

  const RICH_MESSAGE_TOOLBAR = [
    ["bold", "italic", "underline"],
    ["link", "image"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["blockquote"],
    ["clean"],
  ];

  const DOMPURIFY_MESSAGE_CONFIG = {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "s",
      "a",
      "img",
      "ol",
      "ul",
      "li",
      "h1",
      "h2",
      "h3",
      "blockquote",
      "code",
      "pre",
      "span",
    ],
    ALLOWED_ATTR: [
      "href",
      "target",
      "rel",
      "class",
      "src",
      "alt",
      "loading",
      "width",
      "height",
      "style",
    ],
  };

  function isHtmlContent(value) {
    return /<[^>]+>/.test(String(value || ""));
  }

  function sanitizeRichBody(raw) {
    if (!window.DOMPurify) {
      return { error: "Zengin metin editörü şu an kullanılamıyor." };
    }

    const body = window.DOMPurify.sanitize(String(raw || "").trim(), DOMPURIFY_MESSAGE_CONFIG);
    const plain = body
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const hasImage = /<img\b/i.test(body);

    if (!plain && !hasImage) {
      return { error: "Mesaj boş olamaz." };
    }
    if (body.length > MAX_RICH_BODY) {
      return { error: `Mesaj en fazla ${MAX_RICH_BODY} karakter olabilir.` };
    }
    return { body };
  }

  function renderMessageBody(element, body) {
    if (isHtmlContent(body) && window.RekabetliQuill?.renderRichContent) {
      element.classList.add("mentor-msg-body", "mentor-msg-body--rich", "rich-content");
      window.RekabetliQuill.renderRichContent(element, body);
      return;
    }
    element.className = "mentor-msg-body";
    element.textContent = body;
  }

  function messagePreviewText(body) {
    const text = String(body || "");
    if (!isHtmlContent(text)) {
      return text.length > 120 ? `${text.slice(0, 120)}…` : text;
    }
    const tmp = document.createElement("div");
    window.RekabetliQuill?.renderRichContent?.(tmp, text);
    const plain = (tmp.textContent || "").replace(/\s+/g, " ").trim();
    return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
  }

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
      openMessaging:
        params.get("openMessaging") === "1" || params.get("openMessages") === "1",
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

      const body = document.createElement("div");
      renderMessageBody(body, msg.body);

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

  function createRichComposeForm({ placeholder, submitLabel, onSubmit }) {
    const form = document.createElement("form");
    form.className = "mentor-msg-compose mentor-msg-compose--rich";

    const editorHost = document.createElement("div");
    editorHost.className = "mentor-msg-editor-host quill-editor-host";
    editorHost.setAttribute("aria-label", placeholder || "Mesaj");

    const actions = document.createElement("div");
    actions.className = "mentor-msg-compose-actions";

    const message = document.createElement("p");
    message.className = "form-message mentor-msg-form-message";
    message.hidden = true;
    message.setAttribute("role", "status");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = submitLabel;

    actions.appendChild(submit);
    form.append(editorHost, message, actions);

    let quill = null;

    function ensureEditor() {
      if (quill) return quill;
      if (!window.RekabetliQuill?.create) return null;
      quill = window.RekabetliQuill.create(editorHost, {
        placeholder,
        maxLength: MAX_RICH_BODY,
        toolbar: RICH_MESSAGE_TOOLBAR,
      });
      if (quill) form._rekabetliQuill = quill;
      return quill;
    }

    ensureEditor();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.hidden = true;

      const editor = ensureEditor();
      if (!editor) {
        message.hidden = false;
        message.textContent = "Zengin metin editörü yüklenemedi.";
        message.classList.add("is-error");
        return;
      }

      if (window.RekabetliQuill.isEmpty(editor)) {
        message.hidden = false;
        message.textContent = "Mesaj boş olamaz.";
        message.classList.add("is-error");
        return;
      }

      const parsed = sanitizeRichBody(window.RekabetliQuill.getHtml(editor));
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

      window.RekabetliQuill.clear(editor);
      message.hidden = false;
      message.textContent = result?.successMessage || "Gönderildi.";
      message.classList.remove("is-error");
    });

    return { form, ensureEditor, message };
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

  const PACKAGE_STUDENT_ERROR_MESSAGES = {
    auth_required: "Giriş yapmalısınız.",
    mentor_required: "Yalnızca mentörler bu işlemi yapabilir.",
    student_not_linked: "Öğrenci bulunamadı veya panele ekli değil.",
    invalid_package: "Geçerli bir paket seçin.",
    package_not_found: "Paket bulunamadı.",
    not_enrolled: "Öğrenci bu pakete kayıtlı değil.",
  };

  function mapPackageStudentError(error) {
    const msg = error?.message || "";
    for (const [key, label] of Object.entries(PACKAGE_STUDENT_ERROR_MESSAGES)) {
      if (msg.includes(key)) return label;
    }
    return `İşlem tamamlanamadı: ${msg}`;
  }

  async function removeStudentFromPackage({
    mentorId,
    packageId,
    packageTitle,
    studentId,
    displayName,
    mountContext,
    onPackageChanged,
  }) {
    const name = displayName || "Öğrenci";
    const title = packageTitle || "Paket";
    const confirmed = await window.rekabetliConfirm?.({
      title: "Paketten çıkar",
      message: `${name}, ${title} paketinden çıkarılsın mı? Öğrenci panelde kalır.`,
      confirmLabel: "Paketten çıkar",
      danger: true,
    });
    if (!confirmed) return;

    try {
      const { error } = await sb().rpc("unenroll_linked_student_from_package", {
        p_student_id: studentId,
        p_package_id: packageId,
      });
      if (error) throw error;

      if (onPackageChanged) {
        await onPackageChanged();
      } else if (mountContext?.root) {
        await mountPackagePanel({
          ...mountContext,
          mentorId,
          packageId,
          packageTitle,
        });
      }
    } catch (removeError) {
      console.error("unenroll student from package:", removeError);
      window.alert(mapPackageStudentError(removeError));
    }
  }

  async function countUnreadPackageStudentMessages({ mentorId, studentId, conversationId }) {
    const user = await getSessionUser();
    if (!user) return 0;

    let query = sb()
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null)
      .eq("type", "mentor_student_message")
      .eq("mentor_id", mentorId);

    if (conversationId) {
      query = query.eq("conversation_id", conversationId);
    } else if (studentId) {
      query = query.eq("actor_id", studentId);
    } else {
      return 0;
    }

    const { count, error } = await query;
    if (error) {
      console.warn("unread package student messages:", error.message);
      return 0;
    }
    return count ?? 0;
  }

  async function markPackageStudentMessageNotificationsRead({
    mentorId,
    studentId,
    conversationId,
  }) {
    const user = await getSessionUser();
    if (!user) return;

    let query = sb()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null)
      .eq("type", "mentor_student_message")
      .eq("mentor_id", mentorId);

    if (conversationId) {
      query = query.eq("conversation_id", conversationId);
    } else if (studentId) {
      query = query.eq("actor_id", studentId);
    } else {
      return;
    }

    const { error } = await query;
    if (error) {
      console.warn("mark package student notifications read:", error.message);
    }
  }

  const STUDENT_LIST_ACCORDION_THRESHOLD = 3;

  function shouldUseStudentListAccordion(count) {
    return count > STUDENT_LIST_ACCORDION_THRESHOLD;
  }

  function mountStudentListAccordion({ panel, listEl, count, title = "Öğrenciler" }) {
    if (!panel || !listEl) return;

    if (!shouldUseStudentListAccordion(count)) {
      panel.appendChild(listEl);
      return;
    }

    const section = document.createElement("section");
    section.className = "mentor-students-accordion activity-accordion-section";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "activity-accordion-trigger mentor-students-accordion-trigger";
    trigger.setAttribute("aria-expanded", "false");

    const titleSpan = document.createElement("span");
    titleSpan.className = "activity-accordion-title";
    titleSpan.textContent = title;

    const meta = document.createElement("span");
    meta.className = "activity-accordion-meta";

    const countBadge = document.createElement("span");
    countBadge.className = "activity-accordion-count";
    countBadge.textContent = String(count);

    const chevron = document.createElement("span");
    chevron.className = "activity-accordion-chevron";
    chevron.setAttribute("aria-hidden", "true");

    meta.append(countBadge, chevron);
    trigger.append(titleSpan, meta);

    const accordionPanel = document.createElement("div");
    accordionPanel.className = "activity-accordion-panel mentor-students-accordion-panel";
    accordionPanel.appendChild(listEl);

    trigger.addEventListener("click", () => {
      const open = section.classList.toggle("is-open");
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
    });

    section.append(trigger, accordionPanel);
    panel.appendChild(section);
  }

  function renderPackageStudents(panel, students, context = null) {
    panel.replaceChildren();
    if (!students.length) {
      const empty = document.createElement("p");
      empty.className = "mentor-inbox-empty";
      empty.textContent = "Bu pakete henüz öğrenci eklenmedi.";
      panel.appendChild(empty);
      return;
    }

    const list = document.createElement("ul");
    list.className = "mentor-package-students-list";

    students.forEach((student) => {
      const item = document.createElement("li");
      item.className = "mentor-package-students-item";

      const avatarWrap = document.createElement("div");
      avatarWrap.className = "mentor-package-students-avatar";
      const img = document.createElement("img");
      img.className = "mentor-package-students-avatar-img";
      img.alt = "";
      img.hidden = true;
      const fallback = document.createElement("span");
      fallback.className = "mentor-package-students-avatar-fallback";
      fallback.textContent = "?";
      avatarWrap.append(img, fallback);

      if (window.RekabetliAvatars?.applyUserAvatar) {
        window.RekabetliAvatars.applyUserAvatar({
          imgEl: img,
          fallbackEl: fallback,
          avatarUrl: student.avatar_url,
          displayName: student.display_name || "?",
          seed: student.id,
        });
      } else {
        const parts = String(student.display_name || "?").trim().split(/\s+/);
        fallback.textContent =
          parts.length >= 2
            ? (parts[0][0] + parts[1][0]).toUpperCase()
            : (parts[0]?.[0] || "?").toUpperCase();
      }

      const body = document.createElement("div");
      body.className = "mentor-package-students-body";

      const name = document.createElement("p");
      name.className = "mentor-package-students-name";
      name.textContent = student.display_name || "Öğrenci";

      const meta = document.createElement("p");
      meta.className = "mentor-package-students-meta";
      const statusLabel = getEnrollmentStatusLabel(student);
      meta.textContent = student.enrolled_at
        ? `Pakete eklendi: ${formatDate(student.enrolled_at)}`
        : "Pakete eklendi";

      body.append(name, meta);

      if (statusLabel) {
        const statusBadge = document.createElement("span");
        statusBadge.className = "enrollment-status-badge";
        statusBadge.classList.add(
          getEnrollmentAccessStatus(student) === "refunded"
            ? "enrollment-status-badge--refunded"
            : "enrollment-status-badge--pending",
        );
        statusBadge.textContent = statusLabel;
        body.appendChild(statusBadge);
      }

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "mentor-package-students-open";
      if (getEnrollmentAccessStatus(student) === "refunded") {
        item.classList.add("mentor-package-students-item--refunded");
      }
      openBtn.setAttribute(
        "aria-label",
        `${student.display_name || "Öğrenci"} için paket sayfasını aç`,
      );
      openBtn.append(avatarWrap, body);
      openBtn.addEventListener("click", () => {
        context?.onOpenStudent?.({
          id: student.id,
          enrollment_id: student.enrollment_id,
          display_name: student.display_name,
          avatar_url: student.avatar_url,
          enrolled_at: student.enrolled_at,
          unenrolled_at: student.unenrolled_at,
          order_status: student.order_status,
          refund_requested_at: student.refund_requested_at,
          refunded_at: student.refunded_at,
        });
      });

      item.appendChild(openBtn);
      list.appendChild(item);
    });

    if (shouldUseStudentListAccordion(students.length)) {
      mountStudentListAccordion({
        panel,
        listEl: list,
        count: students.length,
        title: "Öğrenciler",
      });
      if (context?.studentsTitleEl) context.studentsTitleEl.hidden = true;
      return;
    }

    if (context?.studentsTitleEl) context.studentsTitleEl.hidden = false;
    panel.appendChild(list);
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
      const preview = last?.body ? messagePreviewText(last.body) : "Henüz mesaj yok";

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
          headPreview.textContent = newLast?.body ? messagePreviewText(newLast.body) : preview;
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

  async function mountPackagePanel({
    root,
    mentorId,
    packageId,
    packageTitle,
    deepLink = null,
    onPackageChanged = null,
    onOpenStudent = null,
  }) {
    if (!root || !vitrin()?.isValidMentorId?.(mentorId)) return;

    const safePackageId = sec()?.sanitizePackageId?.(packageId) || "";
    if (!safePackageId) return;

    root.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "mentor-inbox-empty";
    loading.textContent = "Yükleniyor…";
    root.appendChild(loading);

    const supabase = sb();
    const [enrollmentsResult, requestsResult] = await Promise.all([
      supabase.rpc("get_mentor_package_students_panel", { p_package_id: safePackageId }),
      supabase
        .from("package_requests")
        .select(
          "id, package_id, package_title, package_price, first_name, last_name, email, phone, note, status, created_at",
        )
        .eq("mentor_id", mentorId)
        .eq("package_id", safePackageId)
        .order("created_at", { ascending: false }),
    ]);

    root.replaceChildren();

    const studentsSection = document.createElement("section");
    studentsSection.className = "mentor-package-students-section";
    studentsSection.setAttribute("aria-labelledby", `mentor-package-students-title-${safePackageId}`);

    const studentsTitle = document.createElement("h2");
    studentsTitle.id = `mentor-package-students-title-${safePackageId}`;
    studentsTitle.className = "mentor-package-section-title";
    studentsTitle.textContent = "Öğrenciler";

    const studentsPanel = document.createElement("div");
    studentsPanel.className = "mentor-package-students-panel";

    const requestsSection = document.createElement("section");
    requestsSection.className = "mentor-package-requests-section";
    requestsSection.setAttribute("aria-labelledby", `mentor-package-requests-title-${safePackageId}`);

    const requestsTitle = document.createElement("h2");
    requestsTitle.id = `mentor-package-requests-title-${safePackageId}`;
    requestsTitle.className = "mentor-package-section-title";
    requestsTitle.textContent = "Ön talepler";

    const requestsPanel = document.createElement("div");
    requestsPanel.className = "mentor-package-requests-panel";

    const tasksSection = document.createElement("section");
    tasksSection.className = "mentor-package-tasks-section";
    tasksSection.setAttribute("aria-labelledby", `mentor-package-tasks-title-${safePackageId}`);

    const tasksTitle = document.createElement("h2");
    tasksTitle.id = `mentor-package-tasks-title-${safePackageId}`;
    tasksTitle.className = "mentor-package-section-title";
    tasksTitle.textContent = "Görev paketleri oluştur";

    const tasksPanel = document.createElement("div");
    tasksPanel.className = "mentor-package-tasks-panel";

    tasksSection.append(tasksTitle, tasksPanel);
    studentsSection.append(studentsTitle, studentsPanel);
    requestsSection.append(requestsTitle, requestsPanel);
    root.append(studentsSection, requestsSection, tasksSection);

    const studentRenderContext = {
      mentorId,
      packageId: safePackageId,
      packageTitle: packageTitle || "Paket",
      mountContext: { root, deepLink, onPackageChanged },
      onPackageChanged,
      onOpenStudent,
      studentsTitleEl: studentsTitle,
    };

    if (enrollmentsResult.error) {
      console.error("mentor package students:", enrollmentsResult.error.message);
      studentsPanel.replaceChildren();
      const err = document.createElement("p");
      err.className = "mentor-inbox-empty";
      err.textContent = enrollmentsResult.error.message.includes("mentor_package_students")
        ? "Öğrenci listesi için veritabanı kurulumu gerekli."
        : "Öğrenciler yüklenemedi.";
      studentsPanel.appendChild(err);
    } else {
      const enrollments = enrollmentsResult.data ?? [];
      const students = enrollments.map((row) => ({
        id: row.student_id,
        enrollment_id: row.enrollment_id,
        display_name: row.display_name?.trim() || "Öğrenci",
        avatar_url: row.avatar_url || null,
        enrolled_at: row.enrolled_at,
        unenrolled_at: row.unenrolled_at,
        order_status: row.order_status,
        refund_requested_at: row.refund_requested_at,
        refunded_at: row.refunded_at,
      }));
      renderPackageStudents(studentsPanel, students, studentRenderContext);
    }

    if (requestsResult.error) {
      console.error("mentor package panel:", requestsResult.error.message);
      requestsPanel.replaceChildren();
      const err = document.createElement("p");
      err.className = "mentor-inbox-empty";
      err.textContent = "Ön talepler yüklenemedi.";
      requestsPanel.appendChild(err);
      return;
    }

    const requests = (requestsResult.data ?? []).map((row) => ({
      ...row,
      package_title: row.package_title || packageTitle || "Paket",
    }));
    renderPackageRequests(requestsPanel, requests);

    if (deepLink?.requestId) {
      const card = requestsPanel.querySelector(
        `[data-request-id="${CSS.escape(deepLink.requestId)}"]`,
      );
      applyHighlightScroll(card);
      cleanUrlParams(["inbox", "request"]);
    }

    if (window.RekabetliMentorPackageTasks?.mountSection) {
      await window.RekabetliMentorPackageTasks.mountSection({
        panelEl: tasksPanel,
        mentorId,
        packageId: safePackageId,
      });
    }
  }

  async function mountPackageStudentPanel({
    root,
    mentorId,
    packageId,
    packageTitle,
    studentId,
    onBack = null,
    onPackageChanged = null,
    openSchedule = false,
    scheduleOnboarding = false,
  }) {
    if (!root || !vitrin()?.isValidMentorId?.(mentorId)) return;

    const safePackageId = sec()?.sanitizePackageId?.(packageId) || "";
    const safeStudentId = parseUuidParam(studentId);
    if (!safePackageId || !safeStudentId) return;

    root.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "mentor-inbox-empty";
    loading.textContent = "Yükleniyor…";
    root.appendChild(loading);

    const supabase = sb();
    const [{ data: enrollment, error: enrollmentError }, { data: profile, error: profileError }] =
      await Promise.all([
        supabase
          .from("mentor_package_students")
          .select("created_at, unenrolled_at")
          .eq("mentor_id", mentorId)
          .eq("package_id", safePackageId)
          .eq("student_id", safeStudentId)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .eq("id", safeStudentId)
          .maybeSingle(),
      ]);

    if (enrollmentError || !enrollment) {
      root.replaceChildren();
      const err = document.createElement("p");
      err.className = "mentor-inbox-empty";
      err.textContent = "Öğrenci bu pakette bulunamadı.";
      root.appendChild(err);
      if (onBack) window.setTimeout(() => onBack(), 1200);
      return;
    }

    if (profileError) {
      console.error("package student profile:", profileError.message);
    }

    const displayName = profile?.display_name?.trim() || "Öğrenci";
    const panelViewId = `paket-${safePackageId}-ogrenci-${safeStudentId}`;
    const panelEl = document.querySelector(
      `[data-mentor-panel-view="${CSS.escape(panelViewId)}"]`,
    );
    const pageTitle = panelEl?.querySelector(".mentor-package-student-page-title");
    const pageActions = panelEl?.querySelector(".mentor-package-student-page-actions");
    if (pageTitle) pageTitle.textContent = displayName;

    const { data: orderRow } = await supabase
      .from("package_orders")
      .select("status, refunded_at, refund_requested_at")
      .eq("mentor_id", mentorId)
      .eq("package_id", safePackageId)
      .eq("user_id", safeStudentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const enrollmentState = {
      unenrolled_at: enrollment.unenrolled_at,
      order_status: orderRow?.status || null,
      refund_requested_at: orderRow?.refund_requested_at || null,
      refunded_at: orderRow?.refunded_at || null,
    };

    if (getEnrollmentAccessStatus(enrollmentState) === "refunded") {
      if (pageActions) pageActions.replaceChildren();
      renderRefundedEnrollmentNotice(root, {
        title: `${displayName} · ${packageTitle || "Paket"}`,
        refundedAt: enrollmentState.refunded_at,
      });
      return;
    }

    if (pageActions) {
      pageActions.replaceChildren();
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "secondary mentor-package-students-remove-btn";
      removeBtn.textContent = "Paketten çıkar";
      removeBtn.addEventListener("click", () => {
        void removeStudentFromPackage({
          mentorId,
          packageId: safePackageId,
          packageTitle,
          studentId: safeStudentId,
          displayName,
          onPackageChanged: async () => {
            if (onPackageChanged) await onPackageChanged();
            if (onBack) onBack();
          },
        });
      });
      pageActions.appendChild(removeBtn);
    }

    root.replaceChildren();

    const hero = document.createElement("div");
    hero.className = "mentor-package-student-hero";

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "mentor-package-students-avatar mentor-package-student-hero-avatar";
    const img = document.createElement("img");
    img.className = "mentor-package-students-avatar-img";
    img.alt = "";
    img.hidden = true;
    const fallback = document.createElement("span");
    fallback.className = "mentor-package-students-avatar-fallback";
    fallback.textContent = "?";
    avatarWrap.append(img, fallback);

    if (window.RekabetliAvatars?.applyUserAvatar) {
      window.RekabetliAvatars.applyUserAvatar({
        imgEl: img,
        fallbackEl: fallback,
        avatarUrl: profile?.avatar_url,
        displayName,
        seed: safeStudentId,
      });
    }

    const heroBody = document.createElement("div");
    heroBody.className = "mentor-package-student-hero-body";

    const packageChip = document.createElement("span");
    packageChip.className = "mentor-package-student-package-chip";
    packageChip.textContent = packageTitle || "Paket";

    const enrolledMeta = document.createElement("p");
    enrolledMeta.className = "mentor-package-student-enrolled";
    enrolledMeta.textContent = enrollment.created_at
      ? `Pakete eklendi: ${formatDate(enrollment.created_at)}`
      : "Bu pakete kayıtlı öğrenci";

    heroBody.append(packageChip, enrolledMeta);
    hero.append(avatarWrap, heroBody);

    const messagesAccordion = document.createElement("section");
    messagesAccordion.className = "mentor-package-messages-accordion activity-accordion-section";

    const messagesTrigger = document.createElement("button");
    messagesTrigger.type = "button";
    messagesTrigger.id = `mentor-package-messages-trigger-${safeStudentId}`;
    messagesTrigger.className = "activity-accordion-trigger mentor-package-messages-trigger";
    messagesTrigger.setAttribute("aria-expanded", "false");
    messagesTrigger.setAttribute(
      "aria-controls",
      `mentor-package-messages-panel-${safeStudentId}`,
    );

    const messagesTriggerTitle = document.createElement("span");
    messagesTriggerTitle.className = "activity-accordion-title";
    messagesTriggerTitle.textContent = "Mesajlar";

    const messagesTriggerMeta = document.createElement("span");
    messagesTriggerMeta.className = "activity-accordion-meta";

    const unreadBadge = document.createElement("span");
    unreadBadge.className = "activity-accordion-count mentor-package-messages-unread";
    unreadBadge.hidden = true;
    unreadBadge.setAttribute("aria-label", "Okunmamış mesaj");

    const messagesChevron = document.createElement("span");
    messagesChevron.className = "activity-accordion-chevron";
    messagesChevron.setAttribute("aria-hidden", "true");

    messagesTriggerMeta.append(unreadBadge, messagesChevron);
    messagesTrigger.append(messagesTriggerTitle, messagesTriggerMeta);

    const messagesPanel = document.createElement("div");
    messagesPanel.id = `mentor-package-messages-panel-${safeStudentId}`;
    messagesPanel.className = "activity-accordion-panel mentor-package-messages-panel";
    messagesPanel.setAttribute("role", "region");
    messagesPanel.setAttribute("aria-labelledby", messagesTrigger.id);

    const messageList = document.createElement("div");
    messageList.className = "mentor-msg-list mentor-package-student-msg-list";
    messageList.setAttribute("aria-live", "polite");

    const thread = document.createElement("div");
    thread.className = "mentor-msg-thread";

    let conversationId = null;

    async function syncUnreadBadge() {
      const count = await countUnreadPackageStudentMessages({
        mentorId,
        studentId: safeStudentId,
        conversationId,
      });
      const isOpen = messagesAccordion.classList.contains("is-open");
      if (count > 0 && !isOpen) {
        unreadBadge.hidden = false;
        unreadBadge.textContent = count > 9 ? "9+" : String(count);
      } else {
        unreadBadge.hidden = true;
      }
      return count;
    }

    async function openMessagesAccordion({ markRead = false } = {}) {
      messagesAccordion.classList.add("is-open");
      messagesTrigger.setAttribute("aria-expanded", "true");
      if (markRead) {
        await markPackageStudentMessageNotificationsRead({
          mentorId,
          studentId: safeStudentId,
          conversationId,
        });
        window.rekabetliNotifications?.refresh?.();
      }
      await syncUnreadBadge();
      messageList.scrollTop = messageList.scrollHeight;
    }

    async function refreshMessages() {
      const { data: conv } = await supabase
        .from("mentor_conversations")
        .select("id")
        .eq("mentor_id", mentorId)
        .eq("student_id", safeStudentId)
        .maybeSingle();

      conversationId = conv?.id ?? null;
      if (!conversationId) {
        renderMessageList(messageList, [], mentorId, {
          empty: "Henüz mesaj yok. Aşağıdan öğrenciye yazabilirsiniz.",
          ownLabel: "Siz",
          otherLabel: displayName,
        });
        return;
      }

      const messages = await fetchConversationMessages(conversationId);
      renderMessageList(messageList, messages, mentorId, {
        ownLabel: "Siz",
        otherLabel: displayName,
      });
      messageList.scrollTop = messageList.scrollHeight;
    }

    const { form } = createRichComposeForm({
      placeholder: `${displayName} ile bu paket hakkında yazın…`,
      submitLabel: "Gönder",
      onSubmit: async (body) => {
        const result = await sendMessage({
          conversationId,
          mentorId,
          studentId: safeStudentId,
          body,
        });
        if (result.error) return result;
        conversationId = result.conversationId;
        await refreshMessages();
        if (messagesAccordion.classList.contains("is-open")) {
          messageList.scrollTop = messageList.scrollHeight;
        }
        return { successMessage: "Mesaj gönderildi." };
      },
    });

    thread.append(messageList, form);
    messagesPanel.appendChild(thread);
    messagesAccordion.append(messagesTrigger, messagesPanel);

    const scheduleHost = document.createElement("div");
    scheduleHost.className = "mentor-package-student-schedule-host";

    const tasksSection = document.createElement("section");
    tasksSection.className = "mentor-package-student-tasks-section";
    tasksSection.setAttribute("aria-labelledby", `mentor-package-student-tasks-title-${safeStudentId}`);

    const tasksTitle = document.createElement("h2");
    tasksTitle.id = `mentor-package-student-tasks-title-${safeStudentId}`;
    tasksTitle.className = "mentor-package-section-title";
    tasksTitle.textContent = "Görev paketi";

    const tasksPanel = document.createElement("div");
    tasksPanel.className = "mentor-package-student-tasks-panel";

    tasksSection.append(tasksTitle, tasksPanel);

    messagesTrigger.addEventListener("click", async () => {
      const willOpen = !messagesAccordion.classList.contains("is-open");
      messagesAccordion.classList.toggle("is-open", willOpen);
      messagesTrigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (willOpen) {
        await openMessagesAccordion({ markRead: true });
      } else {
        await syncUnreadBadge();
      }
    });

    root.append(hero, messagesAccordion, scheduleHost, tasksSection);

    if (scheduleOnboarding) {
      const banner = document.createElement("div");
      banner.className = "mentor-schedule-onboarding-banner";
      banner.setAttribute("role", "status");

      const bannerTitle = document.createElement("strong");
      bannerTitle.textContent = "Yeni paket satışı";

      const bannerText = document.createElement("p");
      bannerText.className = "mentor-schedule-onboarding-banner-text";
      bannerText.textContent =
        `${displayName} paketinizi satın aldı. Lütfen en kısa sürede ilk görüşme zamanı tekliflerini gönderin.`;

      banner.append(bannerTitle, bannerText);
      root.insertBefore(banner, hero);
    }

    await refreshMessages();

    if (window.RekabetliMentorMeetingProposals?.mountMentorScheduleSection) {
      await window.RekabetliMentorMeetingProposals.mountMentorScheduleSection({
        root: scheduleHost,
        mentorId,
        packageId: safePackageId,
        studentId: safeStudentId,
        startOpen: openSchedule,
      });
    }

    const deepLink = parseInboxDeepLink();
    const unreadCount = await countUnreadPackageStudentMessages({
      mentorId,
      studentId: safeStudentId,
      conversationId,
    });
    const deepLinkOpens =
      deepLink?.inbox === "messages" &&
      Boolean(deepLink.conversationId) &&
      deepLink.conversationId === conversationId;

    if (unreadCount > 0 || deepLinkOpens) {
      await openMessagesAccordion({ markRead: unreadCount > 0 });
    } else {
      await syncUnreadBadge();
    }

    if (deepLink?.messageId && messagesAccordion.classList.contains("is-open")) {
      const msgEl = messageList.querySelector(
        `[data-message-id="${CSS.escape(deepLink.messageId)}"]`,
      );
      applyHighlightScroll(msgEl);
      cleanUrlParams(["inbox", "conversation", "message"]);
    }

    if (window.RekabetliMentorPackageTasks?.mountStudentSection) {
      await window.RekabetliMentorPackageTasks.mountStudentSection({
        panelEl: tasksPanel,
        mentorId,
        packageId: safePackageId,
        studentId: safeStudentId,
      });
    }
  }

  async function mountStudentEnrollmentPanel({
    root,
    enrollmentId = null,
    mentorId,
    packageId,
    packageTitle,
    mentorName,
    mentorAvatarUrl,
    studentId,
    enrolledAt = null,
    openMessagesOnMount = false,
  }) {
    if (!root || !vitrin()?.isValidMentorId?.(mentorId)) return;

    const safeEnrollmentId = parseUuidParam(enrollmentId);
    const safePackageId = sec()?.sanitizePackageId?.(packageId) || "";
    const safeStudentId = parseUuidParam(studentId);
    const safeMentorId = parseUuidParam(mentorId);
    if (!safePackageId || !safeStudentId || !safeMentorId) return;

    root.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "mentor-inbox-empty";
    loading.textContent = "Yükleniyor…";
    root.appendChild(loading);

    const supabase = sb();
    const { data: enrollment, error: enrollmentError } = await supabase
      .from("mentor_package_students")
      .select("created_at, unenrolled_at")
      .eq("mentor_id", safeMentorId)
      .eq("package_id", safePackageId)
      .eq("student_id", safeStudentId)
      .maybeSingle();

    if (enrollmentError || !enrollment) {
      root.replaceChildren();
      const err = document.createElement("p");
      err.className = "mentor-inbox-empty";
      err.textContent = "Bu pakete kaydınız bulunamadı.";
      root.appendChild(err);
      return;
    }

    const { data: orderRow } = await supabase
      .from("package_orders")
      .select("status, refunded_at, refund_requested_at, refund_amount")
      .eq("mentor_id", safeMentorId)
      .eq("package_id", safePackageId)
      .eq("user_id", safeStudentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const enrollmentState = {
      unenrolled_at: enrollment.unenrolled_at,
      order_status: orderRow?.status || null,
      refund_requested_at: orderRow?.refund_requested_at || null,
      refunded_at: orderRow?.refunded_at || null,
      refund_amount: orderRow?.refund_amount || null,
    };

    if (getEnrollmentAccessStatus(enrollmentState) === "refunded") {
      renderRefundedEnrollmentNotice(root, {
        title: `${mentorName?.trim() || "Mentör"} · ${packageTitle || "Paket"}`,
        refundedAt: enrollmentState.refunded_at,
        subtitle:
          orderRow?.refund_amount
            ? `İade edilen tutar: ${Number(orderRow.refund_amount).toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 })}. Paket erişiminiz kapatıldı.`
            : undefined,
      });
      return;
    }

    const mentorDisplayName = mentorName?.trim() || "Mentör";
    root.replaceChildren();

    const upcomingHost = document.createElement("div");
    upcomingHost.className = "upcoming-meetings-box-host";
    upcomingHost.hidden = true;

    const hero = document.createElement("div");
    hero.className = "mentor-package-student-hero student-enrollment-hero";

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "mentor-package-students-avatar mentor-package-student-hero-avatar";
    const img = document.createElement("img");
    img.className = "mentor-package-students-avatar-img";
    img.alt = "";
    img.hidden = true;
    const fallback = document.createElement("span");
    fallback.className = "mentor-package-students-avatar-fallback";
    fallback.textContent = "?";
    avatarWrap.append(img, fallback);

    if (window.RekabetliAvatars?.applyUserAvatar) {
      window.RekabetliAvatars.applyUserAvatar({
        imgEl: img,
        fallbackEl: fallback,
        avatarUrl: mentorAvatarUrl,
        displayName: mentorDisplayName,
        seed: safeMentorId,
      });
    }

    const heroBody = document.createElement("div");
    heroBody.className = "mentor-package-student-hero-body";

    const mentorNameEl = document.createElement("p");
    mentorNameEl.className = "student-enrollment-mentor-name";
    mentorNameEl.textContent = mentorDisplayName;

    const packageChip = document.createElement("span");
    packageChip.className = "mentor-package-student-package-chip";
    packageChip.textContent = packageTitle || "Paket";

    const enrolledMeta = document.createElement("p");
    enrolledMeta.className = "mentor-package-student-enrolled";
    const enrolledDate = enrolledAt || enrollment.created_at;
    enrolledMeta.textContent = enrolledDate
      ? `Pakete kayıt: ${formatDate(enrolledDate)}`
      : "Bu pakete kayıtlısınız";

    heroBody.append(mentorNameEl, packageChip, enrolledMeta);
    hero.append(avatarWrap, heroBody);

    const messagesAccordion = document.createElement("section");
    messagesAccordion.className =
      "mentor-package-messages-accordion activity-accordion-section is-open";

    const messagesTrigger = document.createElement("button");
    messagesTrigger.type = "button";
    messagesTrigger.className = "activity-accordion-trigger mentor-package-messages-trigger";
    messagesTrigger.setAttribute("aria-expanded", "true");

    const messagesTriggerTitle = document.createElement("span");
    messagesTriggerTitle.className = "activity-accordion-title";
    messagesTriggerTitle.textContent = "Mentör ile mesajlar";

    const messagesTriggerMeta = document.createElement("span");
    messagesTriggerMeta.className = "activity-accordion-meta";
    const unreadBadge = document.createElement("span");
    unreadBadge.className = "activity-accordion-count";
    unreadBadge.hidden = true;
    const messagesChevron = document.createElement("span");
    messagesChevron.className = "activity-accordion-chevron";
    messagesChevron.setAttribute("aria-hidden", "true");
    messagesTriggerMeta.append(unreadBadge, messagesChevron);
    messagesTrigger.append(messagesTriggerTitle, messagesTriggerMeta);

    const messagesPanel = document.createElement("div");
    messagesPanel.className = "activity-accordion-panel mentor-package-messages-panel";

    const messageList = document.createElement("div");
    messageList.className = "mentor-msg-list mentor-package-student-msg-list";
    messageList.setAttribute("aria-live", "polite");

    const thread = document.createElement("div");
    thread.className = "mentor-msg-thread";

    let conversationId = null;
    const panelNotifications = window.RekabetliStudentPanelNotifications;

    async function syncUnreadBadge() {
      if (!panelNotifications) {
        unreadBadge.hidden = true;
        return 0;
      }
      const user = await getSessionUser();
      if (!user) return 0;
      const count = await panelNotifications.countUnreadMentorReplies({
        mentorId: safeMentorId,
        conversationId,
        enrollmentId: safeEnrollmentId,
        userId: user.id,
      });
      const isOpen = messagesAccordion.classList.contains("is-open");
      if (count > 0 && !isOpen) {
        unreadBadge.hidden = false;
        unreadBadge.textContent = count > 9 ? "9+" : String(count);
      } else {
        unreadBadge.hidden = true;
      }
      return count;
    }

    async function openMessagesAccordion({ markRead = false } = {}) {
      messagesAccordion.classList.add("is-open");
      messagesTrigger.setAttribute("aria-expanded", "true");
      if (markRead && panelNotifications) {
        const user = await getSessionUser();
        if (user) {
          await panelNotifications.markMentorReplyNotificationsRead({
            mentorId: safeMentorId,
            conversationId,
            enrollmentId: safeEnrollmentId,
            userId: user.id,
          });
          window.rekabetliNotifications?.refresh?.();
        }
      }
      await syncUnreadBadge();
      messageList.scrollTop = messageList.scrollHeight;
    }

    async function refreshMessages() {
      const { data: conv } = await supabase
        .from("mentor_conversations")
        .select("id")
        .eq("mentor_id", safeMentorId)
        .eq("student_id", safeStudentId)
        .maybeSingle();

      conversationId = conv?.id ?? null;
      if (!conversationId) {
        renderMessageList(messageList, [], safeStudentId, {
          empty: "Henüz mesaj yok. Aşağıdan mentörünüze yazabilirsiniz.",
          ownLabel: "Siz",
          otherLabel: mentorDisplayName,
        });
        return;
      }

      const messages = await fetchConversationMessages(conversationId);
      renderMessageList(messageList, messages, safeStudentId, {
        ownLabel: "Siz",
        otherLabel: mentorDisplayName,
      });
      messageList.scrollTop = messageList.scrollHeight;
    }

    const { form } = createRichComposeForm({
      placeholder: `${mentorDisplayName} ile bu paket hakkında yazın…`,
      submitLabel: "Gönder",
      onSubmit: async (body) => {
        const result = await sendMessage({
          conversationId,
          mentorId: safeMentorId,
          studentId: safeStudentId,
          body,
        });
        if (result.error) return result;
        conversationId = result.conversationId;
        await refreshMessages();
        return { successMessage: "Mesajınız iletildi." };
      },
    });

    thread.append(messageList, form);
    messagesPanel.appendChild(thread);
    messagesAccordion.append(messagesTrigger, messagesPanel);

    messagesTrigger.addEventListener("click", () => {
      const willOpen = !messagesAccordion.classList.contains("is-open");
      messagesAccordion.classList.toggle("is-open", willOpen);
      messagesTrigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (willOpen) {
        void openMessagesAccordion({ markRead: true });
      } else {
        void syncUnreadBadge();
      }
    });

    const scheduleHost = document.createElement("div");
    scheduleHost.className = "student-enrollment-schedule-host";

    const tasksSection = document.createElement("section");
    tasksSection.className = "mentor-package-student-tasks-section";
    tasksSection.setAttribute("aria-labelledby", `student-enrollment-tasks-title-${safePackageId}`);

    const tasksTitle = document.createElement("h2");
    tasksTitle.id = `student-enrollment-tasks-title-${safePackageId}`;
    tasksTitle.className = "mentor-package-section-title";
    tasksTitle.textContent = "Görevler";

    const tasksPanel = document.createElement("div");
    tasksPanel.className = "mentor-package-student-tasks-panel";

    const calendarHost = document.createElement("div");
    calendarHost.className = "all-meetings-calendar-host";
    calendarHost.hidden = true;

    tasksSection.append(tasksTitle, tasksPanel);
    root.append(upcomingHost, hero, scheduleHost, messagesAccordion, tasksSection, calendarHost);

    const openStudentMeetingFromEnrollment = (meeting) => {
      window.dispatchEvent(
        new CustomEvent("rekabetli:student-open-meeting", { detail: { meeting } }),
      );
    };

    if (window.RekabetliMentorMeetingProposals?.mountUpcomingMeetingsBox) {
      void window.RekabetliMentorMeetingProposals.mountUpcomingMeetingsBox(upcomingHost, {
        mentorId: safeMentorId,
        studentId: safeStudentId,
        packageId: safePackageId,
        perspective: "student",
        onOpenMeeting: openStudentMeetingFromEnrollment,
      });
    }

    await refreshMessages();

    if (openMessagesOnMount) {
      await openMessagesAccordion({ markRead: true });
    } else if (messagesAccordion.classList.contains("is-open")) {
      await openMessagesAccordion({ markRead: true });
    } else {
      await syncUnreadBadge();
    }

    if (window.RekabetliMentorMeetingProposals?.mountStudentScheduleSection) {
      await window.RekabetliMentorMeetingProposals.mountStudentScheduleSection({
        root: scheduleHost,
        mentorId: safeMentorId,
        packageId: safePackageId,
        studentId: safeStudentId,
        mentorName: mentorDisplayName,
        packageTitle: packageTitle || "Paket",
      });
    }

    if (window.RekabetliMentorPackageTasks?.mountStudentReadOnlySection) {
      await window.RekabetliMentorPackageTasks.mountStudentReadOnlySection({
        panelEl: tasksPanel,
        mentorId: safeMentorId,
        packageId: safePackageId,
      });
    }

    if (window.RekabetliMentorMeetingProposals?.mountAllMeetingsCalendar) {
      void window.RekabetliMentorMeetingProposals.mountAllMeetingsCalendar(calendarHost, {
        mentorId: safeMentorId,
        studentId: safeStudentId,
        packageId: safePackageId,
        perspective: "student",
        onOpenMeeting: openStudentMeetingFromEnrollment,
      });
    }
  }

  window.RekabetliMentorMessaging = {
    mountStudentPanel,
    mountMentorInbox,
    mountPackagePanel,
    mountPackageStudentPanel,
    mountStudentEnrollmentPanel,
    mountStudentListAccordion,
    shouldUseStudentListAccordion,
    parseInboxDeepLink,
    parseStudentMessagingDeepLink,
  };
})();
