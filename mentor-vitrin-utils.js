(function initMentorVitrinUtils() {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const MENTOR_ACCENT_PALETTE = [
    { id: "blue", label: "Mavi" },
    { id: "violet", label: "Mor" },
    { id: "indigo", label: "İndigo" },
    { id: "sky", label: "Gökyüzü" },
    { id: "cyan", label: "Camgöbeği" },
    { id: "teal", label: "Turkuaz" },
    { id: "mint", label: "Nane" },
    { id: "emerald", label: "Yeşil" },
    { id: "lime", label: "Limon" },
    { id: "gold", label: "Altın" },
    { id: "amber", label: "Kehribar" },
    { id: "orange", label: "Turuncu" },
    { id: "coral", label: "Mercan" },
    { id: "rose", label: "Gül" },
    { id: "pink", label: "Pembe" },
  ];

  const ACCENT_IDS = new Set(MENTOR_ACCENT_PALETTE.map((entry) => entry.id));
  const FALLBACK_ACCENTS = {
    branch: ["blue", "violet", "emerald", "amber", "rose"],
    lesson: ["cyan", "teal", "orange", "pink", "lime"],
    package: ["gold", "sky", "indigo", "mint", "coral"],
  };

  function isValidMentorId(value) {
    return UUID_RE.test(String(value || "").trim());
  }

  function mentorPublicUrl(userId) {
    return `/mentor?id=${encodeURIComponent(userId)}`;
  }

  function getInitials(name) {
    const parts = String(name || "?")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.[0] ?? "?").toUpperCase();
  }

  function parseJsonArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function itemTitles(items) {
    return parseJsonArray(items)
      .map((item) => String(item?.title || "").trim())
      .filter(Boolean);
  }

  function excerptText(text, maxLen = 160) {
    const trimmed = String(text || "").trim().replace(/\s+/g, " ");
    if (!trimmed) return "";
    if (trimmed.length <= maxLen) return trimmed;
    return `${trimmed.slice(0, maxLen - 1).trim()}…`;
  }

  function formatPriceTry(price) {
    if (price == null || Number.isNaN(Number(price))) return "";
    return `${Number(price).toLocaleString("tr-TR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })} ₺`;
  }

  function getLowestPackagePrice(packages) {
    const prices = parseJsonArray(packages)
      .map((item) => item?.price)
      .filter((price) => price != null && Number.isFinite(Number(price)) && Number(price) >= 0)
      .map(Number);
    if (!prices.length) return null;
    return Math.min(...prices);
  }

  function formatStartingPriceLabel(price) {
    const formatted = formatPriceTry(price);
    if (!formatted) return "";
    return `${formatted}'den başlayan fiyatlarla`;
  }

  const LOW_CAPACITY_THRESHOLD = 3;

  function sanitizeCapacity(value) {
    if (value == null || value === "") return null;
    const num = Number.parseInt(String(value).trim(), 10);
    if (!Number.isFinite(num) || num < 1 || num > 9999) return null;
    return num;
  }

  const MEETING_PERIOD_IDS = new Set(["once", "week", "month", "year"]);

  const MEETING_PERIOD_LABELS = {
    once: "Tek sefer",
    week: "Haftada",
    month: "Ayda",
    year: "Yılda",
  };

  const MEETING_PLATFORMS = {
    google_meet: {
      id: "google_meet",
      label: "Google Meet",
      recommended: true,
    },
    zoom: {
      id: "zoom",
      label: "Zoom",
      recommended: false,
    },
  };

  function sanitizeMeetingPlatform(value) {
    const id = String(value || "").trim();
    return id === "google_meet" || id === "zoom" ? id : null;
  }

  function isGoogleMeetUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname === "meet.google.com";
    } catch {
      return false;
    }
  }

  function isZoomMeetingUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return false;
      const host = parsed.hostname.toLowerCase();
      return host === "zoom.us" || host.endsWith(".zoom.us");
    } catch {
      return false;
    }
  }

  function sanitizeMeetingLink(platform, url) {
    const sec = window.RekabetliSecurity;
    const raw = String(url || "").trim();
    if (!raw) return null;
    if (!sec?.isSafeHttpUrl?.(raw)) return null;
    const safePlatform = sanitizeMeetingPlatform(platform);
    if (!safePlatform) return null;
    if (safePlatform === "google_meet" && !isGoogleMeetUrl(raw)) return null;
    if (safePlatform === "zoom" && !isZoomMeetingUrl(raw)) return null;
    return raw.slice(0, 500);
  }

  function hasConsultationMeetingLink(page) {
    return Boolean(page?.meetingPlatform && page?.meetingLink);
  }

  function sanitizePayoutAccountHolder(value) {
    const sec = window.RekabetliSecurity;
    const text = sec?.sanitizePersonName?.(value, 120) || String(value || "").trim().slice(0, 120);
    if (!text || text.length < 3) return null;
    return text;
  }

  function sanitizePayoutBankName(value) {
    const sec = window.RekabetliSecurity;
    const text = sec?.sanitizePlainText?.(value, 80) || String(value || "").trim().slice(0, 80);
    if (!text || text.length < 2) return null;
    return text;
  }

  function sanitizeTurkishIban(value) {
    const raw = String(value || "")
      .replace(/\s+/g, "")
      .toUpperCase();
    if (!/^TR\d{24}$/.test(raw)) return null;

    const rearranged = raw.slice(4) + raw.slice(0, 4);
    const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
    let remainder = 0;
    for (let i = 0; i < numeric.length; i += 7) {
      remainder = Number(String(remainder) + numeric.slice(i, i + 7)) % 97;
    }
    if (remainder !== 1) return null;
    return raw;
  }

  function formatTurkishIbanDisplay(iban) {
    const safe = sanitizeTurkishIban(iban);
    if (!safe) return formatIbanDraftDisplay(iban);
    const banks = window.RekabetliTurkishBanks;
    if (banks?.formatTurkishIbanInput) {
      return banks.formatTurkishIbanInput(safe);
    }
    return safe.replace(/(.{4})/g, "$1 ").trim();
  }

  function formatIbanDraftDisplay(value) {
    const banks = window.RekabetliTurkishBanks;
    if (banks?.formatTurkishIbanInput) {
      return banks.formatTurkishIbanInput(value);
    }
    const compact = String(value || "")
      .replace(/\s+/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 26);
    return compact.replace(/(.{4})/g, "$1 ").trim();
  }

  function hasPayoutBankDetails(page) {
    if (page?.payoutReady) return true;
    const holder = sanitizePayoutAccountHolder(page?.accountHolder ?? page?.payoutAccountHolder);
    const bank = sanitizePayoutBankName(page?.bankName ?? page?.payoutBankName);
    const iban = sanitizeTurkishIban(page?.iban ?? page?.payoutIban);
    return Boolean(holder && bank && iban);
  }

  function isVitrinActive(value) {
    return value !== false;
  }

  function normalizeVitrinReviewStatus(value) {
    const status = String(value || "draft").trim().toLowerCase();
    if (status === "pending" || status === "approved" || status === "rejected") {
      return status;
    }
    return "draft";
  }

  function isVitrinReviewApproved(row) {
    const status = normalizeVitrinReviewStatus(
      row?.vitrin_review_status ?? row?.vitrinReviewStatus,
    );
    return status === "approved";
  }

  function vitrinReviewStatusLabel(status) {
    const normalized = normalizeVitrinReviewStatus(status);
    if (normalized === "pending") return "İnceleniyor";
    if (normalized === "approved") return "Yayında";
    if (normalized === "rejected") return "Reddedildi";
    return "Taslak";
  }

  function vitrinAvailabilityLabel(vitrinActive) {
    return isVitrinActive(vitrinActive) ? "Aktif" : "Meşgul";
  }

  function updateVitrinAvailabilityBadge(el, vitrinActive) {
    if (!el) return;
    const active = isVitrinActive(vitrinActive);
    el.textContent = vitrinAvailabilityLabel(active);
    el.classList.toggle("is-active", active);
    el.classList.toggle("is-busy", !active);
    el.hidden = false;
  }

  const VITRIN_BUSY_WATCH_MESSAGE =
    "Bu mentör şu anda meşgul olduğu için yeni öğrenci kabul etmiyor. İstersen kaydet, aktif hale geldiğinde sana bildirelim.";

  const VITRIN_WATCH_PENDING_KEY = "rekabetli_pending_vitrin_watch";
  const PACKAGE_CHECKOUT_PENDING_KEY = "rekabetli_pending_package_checkout";
  let checkoutLoadingOverlay = null;

  function ensureCheckoutLoadingOverlay() {
    if (checkoutLoadingOverlay) return checkoutLoadingOverlay;
    const overlay = document.createElement("div");
    overlay.className = "checkout-loading-overlay";
    overlay.hidden = true;

    const card = document.createElement("div");
    card.className = "checkout-loading-card";
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");

    const spinner = document.createElement("span");
    spinner.className = "checkout-loading-spinner";
    spinner.setAttribute("aria-hidden", "true");

    const title = document.createElement("p");
    title.className = "checkout-loading-title";
    title.textContent = "Ödeme sayfasına yönlendiriliyor";

    const message = document.createElement("p");
    message.className = "checkout-loading-message";
    message.textContent = "Lütfen bekleyiniz…";

    card.append(spinner, title, message);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    checkoutLoadingOverlay = overlay;
    return overlay;
  }

  function showCheckoutLoading() {
    const overlay = ensureCheckoutLoadingOverlay();
    overlay.hidden = false;
  }

  function hideCheckoutLoading() {
    if (!checkoutLoadingOverlay) return;
    checkoutLoadingOverlay.hidden = true;
  }

  async function showCheckoutErrorAlert(options) {
    hideCheckoutLoading();
    await window.rekabetliAlert?.(options);
  }

  async function userAlreadyOwnsPackage(supabase, mentorId, packageId) {
    if (!supabase || !mentorId || !packageId) return false;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return false;

    const { data: enrollment, error: enrollmentError } = await supabase
      .from("mentor_package_students")
      .select("id")
      .eq("mentor_id", mentorId)
      .eq("student_id", userId)
      .eq("package_id", packageId)
      .maybeSingle();

    if (!enrollmentError && enrollment?.id) return true;

    const { data: paidOrder } = await supabase
      .from("package_orders")
      .select("id")
      .eq("user_id", userId)
      .eq("mentor_id", mentorId)
      .eq("package_id", packageId)
      .eq("status", "paid")
      .limit(1)
      .maybeSingle();

    return Boolean(paidOrder?.id);
  }

  function getSupabaseClient() {
    return window.getSupabase?.() || window.sb || null;
  }

  async function fetchVitrinAvailabilityWatch(mentorId) {
    const supabase = getSupabaseClient();
    if (!supabase || !isValidMentorId(mentorId)) return false;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) return false;

    const { data, error } = await supabase
      .from("mentor_vitrin_availability_watches")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("mentor_id", mentorId)
      .is("notified_at", null)
      .maybeSingle();

    if (error) {
      console.error("vitrin availability watch:", error.message);
      return false;
    }

    return Boolean(data);
  }

  async function subscribeVitrinAvailabilityWatch({ mentorId, mentorName }) {
    const supabase = getSupabaseClient();
    if (!supabase || !isValidMentorId(mentorId)) return { ok: false, reason: "invalid" };

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      try {
        sessionStorage.setItem(
          VITRIN_WATCH_PENDING_KEY,
          JSON.stringify({ mentorId: String(mentorId).trim() }),
        );
      } catch {
        /* ignore */
      }
      const redirect = `/mentor?id=${encodeURIComponent(mentorId)}&watchVitrin=1`;
      window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`;
      return { ok: false, reason: "login" };
    }

    const { error } = await supabase.rpc("subscribe_mentor_vitrin_availability", {
      p_mentor_id: mentorId,
    });

    if (error) {
      console.error("subscribe vitrin watch:", error.message);
      const message = String(error.message || "");
      if (message.includes("mentor_vitrin_watch_not_busy")) {
        return { ok: false, reason: "not_busy" };
      }
      if (message.includes("mentor_vitrin_watch_invalid_mentor")) {
        return { ok: false, reason: "invalid" };
      }
      return { ok: false, reason: "error" };
    }

    const label = mentorName ? `“${mentorName}”` : "Mentör";
    if (typeof window.rekabetliAlert === "function") {
      await window.rekabetliAlert({
        title: "Kaydedildi",
        message: `${label} aktif hale geldiğinde size bildirim göndereceğiz.`,
        confirmLabel: "Tamam",
        showCancel: false,
      });
    }

    return { ok: true };
  }

  function restorePendingVitrinWatchFromStorage() {
    try {
      const raw = sessionStorage.getItem(VITRIN_WATCH_PENDING_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const mentorId = isValidMentorId(parsed?.mentorId) ? String(parsed.mentorId).trim() : "";
      if (!mentorId) {
        sessionStorage.removeItem(VITRIN_WATCH_PENDING_KEY);
        return null;
      }
      return { mentorId };
    } catch {
      sessionStorage.removeItem(VITRIN_WATCH_PENDING_KEY);
      return null;
    }
  }

  function mountVitrinAvailabilityUI(container, options = {}) {
    if (!container) return null;

    const vitrinActive = isVitrinActive(options.vitrinActive);
    const mentorId = isValidMentorId(options.mentorId) ? String(options.mentorId).trim() : "";
    const mentorName = String(options.mentorName || "Mentör").trim() || "Mentör";
    const enableWatch = options.enableWatch === true && mentorId;

    container.replaceChildren();
    container.hidden = false;
    container.className = "mentor-vitrin-availability-slot";

    if (vitrinActive) {
      const badge = document.createElement("span");
      badge.className = "mentor-vitrin-availability-badge is-active";
      badge.textContent = vitrinAvailabilityLabel(true);
      container.appendChild(badge);
      return { refresh: async () => mountVitrinAvailabilityUI(container, options) };
    }

    if (!enableWatch) {
      const badge = document.createElement("span");
      badge.className = "mentor-vitrin-availability-badge is-busy";
      badge.textContent = vitrinAvailabilityLabel(false);
      container.appendChild(badge);
      return { refresh: async () => mountVitrinAvailabilityUI(container, options) };
    }

    const busyWrap = document.createElement("div");
    busyWrap.className = "mentor-vitrin-availability-busy-wrap";

    const triggerWrap = document.createElement("div");
    triggerWrap.className = "mentor-vitrin-availability-busy-trigger-wrap";

    const badgeBtn = document.createElement("button");
    badgeBtn.type = "button";
    badgeBtn.className =
      "mentor-vitrin-availability-badge is-busy mentor-vitrin-availability-badge--interactive";
    badgeBtn.textContent = vitrinAvailabilityLabel(false);
    badgeBtn.setAttribute("aria-expanded", "false");
    badgeBtn.setAttribute("aria-describedby", `mentor-vitrin-busy-popover-${mentorId}`);

    const popover = document.createElement("div");
    popover.id = `mentor-vitrin-busy-popover-${mentorId}`;
    popover.className = "mentor-vitrin-availability-popover";
    popover.hidden = true;
    popover.setAttribute("role", "tooltip");

    const popoverText = document.createElement("p");
    popoverText.textContent = VITRIN_BUSY_WATCH_MESSAGE;
    popover.appendChild(popoverText);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "mentor-vitrin-availability-save-btn secondary";
    saveBtn.textContent = "Kaydet";

    triggerWrap.append(badgeBtn, popover);
    busyWrap.append(triggerWrap, saveBtn);
    container.appendChild(busyWrap);

    let popoverOpen = false;
    let hoverCloseTimer = null;
    let subscribed = false;
    let saving = false;

    function setPopoverOpen(open) {
      popoverOpen = open;
      popover.hidden = !open;
      badgeBtn.setAttribute("aria-expanded", open ? "true" : "false");
      triggerWrap.classList.toggle("is-open", open);
    }

    function clearHoverCloseTimer() {
      if (hoverCloseTimer) {
        clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
      }
    }

    function scheduleHoverClose() {
      clearHoverCloseTimer();
      hoverCloseTimer = setTimeout(() => {
        if (!triggerWrap.matches(":hover") && !popover.matches(":hover")) {
          setPopoverOpen(false);
        }
      }, 120);
    }

    function updateSaveButton() {
      saveBtn.disabled = saving || subscribed;
      saveBtn.textContent = subscribed ? "Kaydedildi" : "Kaydet";
      saveBtn.classList.toggle("is-saved", subscribed);
    }

    async function refreshWatchState() {
      subscribed = await fetchVitrinAvailabilityWatch(mentorId);
      updateSaveButton();
    }

    badgeBtn.addEventListener("mouseenter", () => {
      clearHoverCloseTimer();
      setPopoverOpen(true);
    });

    badgeBtn.addEventListener("mouseleave", scheduleHoverClose);

    popover.addEventListener("mouseenter", clearHoverCloseTimer);
    popover.addEventListener("mouseleave", scheduleHoverClose);

    badgeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setPopoverOpen(!popoverOpen);
    });

    saveBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (saving || subscribed) return;
      saving = true;
      updateSaveButton();
      const result = await subscribeVitrinAvailabilityWatch({ mentorId, mentorName });
      saving = false;
      if (result.ok) {
        subscribed = true;
        sessionStorage.removeItem(VITRIN_WATCH_PENDING_KEY);
      } else if (result.reason === "not_busy") {
        await window.rekabetliAlert?.({
          title: "Mentör aktif",
          message: "Bu mentör artık meşgul değil; paketleri inceleyebilirsiniz.",
          confirmLabel: "Tamam",
          showCancel: false,
        });
        void mountVitrinAvailabilityUI(container, { ...options, vitrinActive: true });
        return;
      } else if (result.reason === "error") {
        await window.rekabetliAlert?.({
          title: "Kaydedilemedi",
          message: "Bildirim kaydı oluşturulamadı. Lütfen tekrar deneyin.",
          confirmLabel: "Tamam",
          showCancel: false,
        });
      }
      updateSaveButton();
    });

    const onDocumentClick = (event) => {
      if (!(event.target instanceof Node)) return;
      if (triggerWrap.contains(event.target)) return;
      setPopoverOpen(false);
    };

    document.addEventListener("click", onDocumentClick);
    void refreshWatchState();

    return {
      refresh: async () => {
        document.removeEventListener("click", onDocumentClick);
        clearHoverCloseTimer();
        return mountVitrinAvailabilityUI(container, options);
      },
      subscribeIfPending: async () => {
        const pending = restorePendingVitrinWatchFromStorage();
        if (!pending || pending.mentorId !== mentorId || subscribed) return false;
        saving = true;
        updateSaveButton();
        const result = await subscribeVitrinAvailabilityWatch({ mentorId, mentorName });
        saving = false;
        if (result.ok) {
          subscribed = true;
          sessionStorage.removeItem(VITRIN_WATCH_PENDING_KEY);
        }
        updateSaveButton();
        return result.ok;
      },
    };
  }

  const MEETING_PERIOD_SUFFIX = {
    week: "hafta",
    month: "ay",
    year: "yıl",
  };

  function sanitizeMeetingPeriod(value) {
    const id = String(value || "").trim().toLowerCase();
    return MEETING_PERIOD_IDS.has(id) ? id : null;
  }

  function sanitizeMeetingCount(value) {
    if (value == null || value === "") return null;
    const num = Number.parseInt(String(value).trim(), 10);
    if (!Number.isFinite(num) || num < 1 || num > 99) return null;
    return num;
  }

  function normalizePackageMeetings(item) {
    const meeting_period = sanitizeMeetingPeriod(item?.meeting_period);
    if (!meeting_period) {
      return { meeting_period: null, meeting_count: null };
    }
    if (meeting_period === "once") {
      return { meeting_period, meeting_count: null };
    }
    return {
      meeting_period,
      meeting_count: sanitizeMeetingCount(item?.meeting_count),
    };
  }

  function formatMeetingScheduleLabel(period, count) {
    const safePeriod = sanitizeMeetingPeriod(period);
    if (!safePeriod) return "";
    if (safePeriod === "once") return "tek seferlik";
    const safeCount = sanitizeMeetingCount(count);
    if (!safeCount) return "";
    const suffix = MEETING_PERIOD_SUFFIX[safePeriod];
    return suffix ? `${safeCount}/${suffix}` : "";
  }

  function getRemainingCapacity(capacity, filledCount = 0) {
    const cap = sanitizeCapacity(capacity);
    if (cap == null) return null;
    const filled = Math.max(0, Number(filledCount) || 0);
    return Math.max(0, cap - filled);
  }

  function createPackageCapacityEl(capacity, filledCount = 0) {
    const cap = sanitizeCapacity(capacity);
    if (cap == null) return null;

    const remaining = getRemainingCapacity(cap, filledCount);
    const el = document.createElement("p");
    el.className = "mentor-vitrin-capacity";

    if (remaining <= 0) {
      el.classList.add("mentor-vitrin-capacity--full");
      el.textContent = "Kapasite doldu";
      return el;
    }

    el.textContent = `Kalan kapasite: ${remaining} kişi`;
    if (remaining <= LOW_CAPACITY_THRESHOLD) {
      el.classList.add("mentor-vitrin-capacity--low");
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
    }
    return el;
  }

  async function fetchPackageFillCounts(supabase, mentorId) {
    if (!supabase || !mentorId) return new Map();
    const { data, error } = await supabase.rpc("get_mentor_package_fill_counts", {
      p_mentor_id: mentorId,
    });
    if (error) {
      console.warn("package fill counts:", error.message);
      return new Map();
    }
    return new Map(
      (data ?? []).map((row) => [String(row.package_id), Number(row.fill_count) || 0]),
    );
  }

  async function readFunctionInvokeError(error, data) {
    if (data && typeof data === "object") {
      if (typeof data.message === "string" && data.message.trim()) return data.message.trim();
      if (data.error === "stripe_checkout_failed" && typeof data.message === "string") {
        return data.message;
      }
    }

    const context = error?.context;
    if (context && typeof context.json === "function") {
      try {
        const body = await context.json();
        if (typeof body?.message === "string" && body.message.trim()) return body.message.trim();
        if (typeof body?.error === "string" && body.error) {
          const codeMessages = {
            server_misconfigured: "Ödeme sunucusu yapılandırılmamış. Yöneticiye bildirin.",
            stripe_checkout_failed: "Stripe ödeme oturumu açılamadı.",
            session_attach_failed: "Ödeme oturumu kaydedilemedi.",
            invalid_order_response: "Sipariş yanıtı geçersiz.",
            package_order_failed: "Sipariş oluşturulamadı. Veritabanı migration'ları çalıştırıldı mı?",
          };
          if (body.message) return body.message;
          return codeMessages[body.error] || body.error;
        }
      } catch {
        /* ignore parse errors */
      }
    }

    if (typeof error?.message === "string" && error.message.trim()) {
      return error.message.trim();
    }

    return "Ödeme sayfası açılamadı. Lütfen tekrar deneyin.";
  }

  async function startPackageCheckout(context) {
    const sec = window.RekabetliSecurity;
    const packageId = sec?.sanitizePackageId?.(context?.packageId) || "";
    const mentorId = isValidMentorId(context?.mentorId) ? String(context.mentorId).trim() : "";
    if (!packageId || !mentorId) return { ok: false, reason: "invalid" };

    if (context?.mentorAcceptsPayments === false) {
      if (typeof window.rekabetliAlert === "function") {
        await window.rekabetliAlert({
          title: "Mentör meşgul",
          message:
            "Bu mentör şu anda yeni öğrenci kabul etmiyor. Daha sonra tekrar deneyebilir veya başka bir mentör seçebilirsiniz.",
          confirmLabel: "Tamam",
          showCancel: false,
        });
      }
      return { ok: false, reason: "busy" };
    }

    const supabase = getSupabaseClient();
    if (!supabase?.functions?.invoke) {
      await window.rekabetliAlert?.({
        title: "Ödeme başlatılamadı",
        message: "Ödeme altyapısı yüklenemedi. Sayfayı yenileyip tekrar deneyin.",
        confirmLabel: "Tamam",
        showCancel: false,
      });
      return { ok: false, reason: "no_client" };
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const title = sec?.sanitizeBranchText
      ? sec.sanitizeBranchText(context?.title, 120)
      : String(context?.title || "Paket").trim().slice(0, 120) || "Paket";

    const pending = { mentorId, packageId, title };

    if (!session?.user?.id) {
      try {
        sessionStorage.setItem(PACKAGE_CHECKOUT_PENDING_KEY, JSON.stringify(pending));
      } catch {
        /* ignore */
      }
      const redirect = `/mentor?id=${encodeURIComponent(mentorId)}&openCheckout=1&packageId=${encodeURIComponent(packageId)}`;
      window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`;
      return { ok: false, reason: "login" };
    }

    showCheckoutLoading();
    const CHECKOUT_TIMEOUT_MS = 45000;

    try {
      const invokePromise = supabase.functions.invoke("create-package-checkout", {
        body: { mentorId, packageId },
      });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("checkout_timeout")), CHECKOUT_TIMEOUT_MS);
      });

      const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

      if (error) {
        const message = await readFunctionInvokeError(error, data);
        console.error("create-package-checkout:", message, error);
        await showCheckoutErrorAlert({
          title: "Satın alma",
          message,
          confirmLabel: "Tamam",
          showCancel: false,
        });
        return { ok: false, reason: "checkout_failed" };
      }

      if (data?.error) {
        const message = await readFunctionInvokeError(null, data);
        console.error("create-package-checkout response:", message, data);
        await showCheckoutErrorAlert({
          title: "Satın alma",
          message,
          confirmLabel: "Tamam",
          showCancel: false,
        });
        return { ok: false, reason: "checkout_failed" };
      }

      const checkoutUrl =
        typeof data?.checkoutUrl === "string"
          ? data.checkoutUrl
          : typeof data?.checkout_url === "string"
            ? data.checkout_url
            : "";

      if (!checkoutUrl || !/^https?:\/\//i.test(checkoutUrl)) {
        await showCheckoutErrorAlert({
          title: "Satın alma",
          message: "Ödeme bağlantısı alınamadı.",
          confirmLabel: "Tamam",
          showCancel: false,
        });
        return { ok: false, reason: "no_url" };
      }

      sessionStorage.removeItem(PACKAGE_CHECKOUT_PENDING_KEY);
      hideCheckoutLoading();
      window.location.assign(checkoutUrl);
      return { ok: true };
    } catch (checkoutError) {
      const timedOut =
        checkoutError instanceof Error && checkoutError.message === "checkout_timeout";
      console.error("create-package-checkout unexpected:", checkoutError);
      await showCheckoutErrorAlert({
        title: "Satın alma",
        message: timedOut
          ? "Ödeme sunucusu yanıt vermedi. Lütfen tekrar deneyin."
          : "Ödeme sayfası açılamadı. Lütfen tekrar deneyin.",
        confirmLabel: "Tamam",
        showCancel: false,
      });
      return { ok: false, reason: timedOut ? "checkout_timeout" : "checkout_error" };
    } finally {
      hideCheckoutLoading();
    }
  }

  function restorePendingPackageCheckoutFromStorage() {
    try {
      const raw = sessionStorage.getItem(PACKAGE_CHECKOUT_PENDING_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const mentorId = isValidMentorId(parsed?.mentorId) ? String(parsed.mentorId).trim() : "";
      const packageId =
        window.RekabetliSecurity?.sanitizePackageId?.(parsed?.packageId) ||
        String(parsed?.packageId || "").trim();
      if (!mentorId || !packageId) {
        sessionStorage.removeItem(PACKAGE_CHECKOUT_PENDING_KEY);
        return null;
      }
      return {
        mentorId,
        packageId,
        title: String(parsed?.title || "Paket").trim() || "Paket",
        mentorAcceptsPayments: true,
      };
    } catch {
      sessionStorage.removeItem(PACKAGE_CHECKOUT_PENDING_KEY);
      return null;
    }
  }

  async function notifyPackageBuy(context) {
    const sec = window.RekabetliSecurity;
    const packageId = sec?.sanitizePackageId?.(context?.packageId) || "";
    const mentorId = isValidMentorId(context?.mentorId) ? String(context.mentorId).trim() : "";
    if (!packageId || !mentorId) return;

    const supabase = getSupabaseClient();
    if (supabase) {
      const alreadyOwned = await userAlreadyOwnsPackage(supabase, mentorId, packageId);
      if (alreadyOwned && typeof window.rekabetliConfirm === "function") {
        const proceed = await window.rekabetliConfirm({
          title: "Paket yenileme",
          message:
            "Bu paketi daha önce satın aldınız. Paketi yenilemek (tekrar ödeme yapmak) istiyor musunuz?",
          confirmLabel: "Yenile",
          cancelLabel: "Vazgeç",
        });
        if (!proceed) return;
      }
    }

    await startPackageCheckout(context);
  }

  function sanitizeAccent(value) {
    const id = String(value || "").trim();
    return ACCENT_IDS.has(id) ? id : null;
  }

  function getAccentForKind(kind, index) {
    const accents = FALLBACK_ACCENTS[kind] || FALLBACK_ACCENTS.branch;
    return accents[index % accents.length];
  }

  function resolveItemAccent(item, kind, index) {
    return sanitizeAccent(item?.accent) || getAccentForKind(kind, index);
  }

  function resolveVitrinAccent(value) {
    return sanitizeAccent(value) || "indigo";
  }

  function applyVitrinShellAccent(element, accent) {
    if (!element) return;
    element.classList.add("mentor-vitrin-shell");
    element.dataset.accent = resolveVitrinAccent(accent);
  }

  function normalizeVitrinItem(item, kind, index) {
    const sec = window.RekabetliSecurity;
    const title = sec?.sanitizeBranchText
      ? sec.sanitizeBranchText(item?.title, 120)
      : String(item?.title || "").trim().slice(0, 120);
    const description = sec?.sanitizePlainText
      ? sec.sanitizePlainText(item?.description ?? item?.content, kind === "package" ? 1200 : 800)
      : String(item?.description ?? item?.content ?? "")
          .trim()
          .slice(0, kind === "package" ? 1200 : 800);
    const id = sec?.sanitizePackageId?.(item?.id) || String(item?.id || "").trim().slice(0, 64);
    const base = {
      id: id || null,
      title,
      accent: resolveItemAccent(item, kind, index),
    };
    if (kind === "package") {
      const priceRaw = item?.price;
      let price = null;
      if (priceRaw != null && priceRaw !== "" && Number.isFinite(Number(priceRaw))) {
        const num = Number(priceRaw);
        if (num >= 0 && num <= 9_999_999) price = Math.round(num * 100) / 100;
      }
      return {
        ...base,
        content: description,
        price,
        capacity: sanitizeCapacity(item?.capacity),
        ...normalizePackageMeetings(item),
      };
    }
    return { ...base, description };
  }

  function normalizePageRow(row) {
    if (!row) return null;
    const sec = window.RekabetliSecurity;
    const profile = row.profiles || {};
    const displayName = sec?.sanitizePersonName
      ? sec.sanitizePersonName(profile.display_name, 120)
      : String(profile.display_name || "Mentör").trim().slice(0, 120) || "Mentör";
    const about = sec?.sanitizeMultilinePlainText
      ? sec.sanitizeMultilinePlainText(row.about, 3000)
      : String(row.about || "").trim().slice(0, 3000);
    const photoCandidate = row.photo_url?.trim() || profile.avatar_url?.trim() || "";
    const photoUrl =
      photoCandidate && sec?.isSafeHttpUrl?.(photoCandidate) ? photoCandidate : null;

    return {
      userId: row.user_id,
      displayName: displayName || "Mentör",
      photoUrl,
      vitrinAccent: resolveVitrinAccent(row.vitrin_accent),
      about,
      branches: parseJsonArray(row.branches).map((item, index) =>
        normalizeVitrinItem(item, "branch", index),
      ),
      lessons: parseJsonArray(row.private_lessons).map((item, index) =>
        normalizeVitrinItem(item, "lesson", index),
      ),
      packages: parseJsonArray(row.packages).map((item, index) =>
        normalizeVitrinItem(item, "package", index),
      ),
      meetingPlatform: sanitizeMeetingPlatform(row.meeting_platform),
      meetingLink: sanitizeMeetingLink(row.meeting_platform, row.meeting_link),
      payoutReady: Boolean(row.payout_ready),
      vitrinActive: isVitrinActive(row.vitrin_active),
      vitrinReviewStatus: normalizeVitrinReviewStatus(row.vitrin_review_status),
      vitrinReviewNote: row.vitrin_review_note?.trim() || null,
      isMentor: Boolean(profile.is_mentor),
    };
  }

  function isListableMentorPage(row) {
    const page = normalizePageRow(row);
    if (!page || !page.isMentor || !page.displayName) return false;
    // Admin onayı yeterli; görüşme linki / ödeme hesabı satış için ayrıca kontrol edilir
    if (!isVitrinReviewApproved(page)) return false;
    const branchTitles = itemTitles(page.branches);
    const lessonTitles = itemTitles(page.lessons);
    return Boolean(
      page.photoUrl || page.about || branchTitles.length || lessonTitles.length,
    );
  }

  function setSafeImage(img, url, options = {}) {
    if (!img) return;
    const sec = window.RekabetliSecurity;
    if (url && sec?.setImgSrc) {
      sec.setImgSrc(img, url, options);
      img.hidden = false;
      return;
    }
    img.hidden = true;
    img.removeAttribute("src");
  }

  function readAccentFromField(root) {
    if (!root) return null;
    const field = root.classList?.contains("mentor-accent-field")
      ? root
      : root.querySelector?.(".mentor-accent-field");
    return sanitizeAccent(field?.dataset.value);
  }

  function createAccentPicker({ selectedAccent, kind, index = 0, onChange }) {
    const field = document.createElement("div");
    field.className = "mentor-accent-field";
    const current = sanitizeAccent(selectedAccent) || getAccentForKind(kind, index);
    field.dataset.value = current;

    const label = document.createElement("span");
    label.className = "mentor-accent-label";
    label.textContent = "Kutu rengi";

    const group = document.createElement("div");
    group.className = "mentor-accent-picker";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Kutu rengi");

    MENTOR_ACCENT_PALETTE.forEach((entry) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mentor-accent-swatch";
      btn.dataset.accent = entry.id;
      btn.title = entry.label;
      btn.setAttribute("aria-label", entry.label);
      btn.setAttribute("role", "radio");
      const isSelected = entry.id === current;
      btn.setAttribute("aria-checked", isSelected ? "true" : "false");
      if (isSelected) btn.classList.add("is-selected");

      btn.addEventListener("click", () => {
        field.dataset.value = entry.id;
        group.querySelectorAll(".mentor-accent-swatch").forEach((swatch) => {
          swatch.classList.remove("is-selected");
          swatch.setAttribute("aria-checked", "false");
        });
        btn.classList.add("is-selected");
        btn.setAttribute("aria-checked", "true");
        onChange?.(entry.id);
      });

      group.appendChild(btn);
    });

    field.append(label, group);
    return field;
  }

  function createSummaryChip(title, kind, index, accentOverride) {
    const li = document.createElement("li");
    li.className = "mentor-summary-chip";
    li.dataset.accent = accentOverride || getAccentForKind(kind, index);
    const text = document.createElement("span");
    text.className = "mentor-summary-chip-text";
    text.textContent = title;
    li.appendChild(text);
    return li;
  }

  function fillSummaryList(container, items, emptyLabel, kind = "branch") {
    if (!container) return;
    container.replaceChildren();

    const isObjectList =
      parseJsonArray(items).length > 0 && typeof items[0] === "object" && items[0] !== null;

    const rows = isObjectList
      ? parseJsonArray(items).filter((item) => String(item?.title || "").trim())
      : items.map((title) => ({ title: String(title || "").trim() })).filter((item) => item.title);

    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "mentor-summary-empty";
      li.textContent = emptyLabel;
      container.appendChild(li);
      return;
    }

    rows.forEach((item, index) => {
      container.appendChild(
        createSummaryChip(item.title, kind, index, resolveItemAccent(item, kind, index)),
      );
    });
  }

  function fillAboutContent(container, text) {
    if (!container) return;
    container.classList.add("mentor-vitrin-about");
    container.replaceChildren();
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      const empty = document.createElement("p");
      empty.className = "mentor-about-empty";
      empty.textContent = "Henüz bir açıklama eklenmemiş.";
      container.appendChild(empty);
      return;
    }
    trimmed
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .forEach((block) => {
        const p = document.createElement("p");
        p.textContent = block;
        container.appendChild(p);
      });
  }

  function renderEmptyState(container, text) {
    const empty = document.createElement("p");
    empty.className = "mentor-vitrin-empty";
    empty.textContent = text;
    container.appendChild(empty);
  }

  function createVitrinBadge(label) {
    const badge = document.createElement("span");
    badge.className = "mentor-vitrin-card-badge";
    badge.textContent = label;
    return badge;
  }

  function createVitrinCard({
    kind,
    title,
    body,
    accent,
    price,
    showBuyButton = false,
    packageId = null,
    itemId = null,
    mentorId = null,
    mentorName = null,
    capacity = null,
    filledCount = 0,
    meetingPeriod = null,
    meetingCount = null,
    mentorAcceptsPayments = true,
  }) {
    const card = document.createElement("article");
    card.className = `mentor-vitrin-card mentor-vitrin-card--${kind}`;
    if (accent) card.dataset.accent = accent;
    if (kind === "package" && packageId) card.dataset.packageId = String(packageId);
    if (itemId) card.dataset.itemId = String(itemId);

    const badgeLabel =
      kind === "branch" ? "Mentörlük" : kind === "lesson" ? "Özel Ders" : "Paket";
    card.appendChild(createVitrinBadge(badgeLabel));

    const titleEl = document.createElement("h3");
    titleEl.className = "mentor-vitrin-card-title";
    titleEl.textContent = title?.trim() || "—";
    card.appendChild(titleEl);

    if (body?.trim()) {
      const bodyEl = document.createElement("p");
      bodyEl.className = "mentor-vitrin-card-body";
      bodyEl.textContent = body.trim();
      card.appendChild(bodyEl);
    }

    if (kind === "package") {
      const scheduleLabel = formatMeetingScheduleLabel(meetingPeriod, meetingCount);
      if (scheduleLabel) {
        const scheduleEl = document.createElement("div");
        scheduleEl.className = "mentor-vitrin-card-meeting";

        const scheduleTitle = document.createElement("span");
        scheduleTitle.className = "mentor-vitrin-card-meeting-label";
        scheduleTitle.textContent = "Görüşme Sıklığı:";

        const scheduleValue = document.createElement("span");
        scheduleValue.className = "mentor-vitrin-card-meeting-value";
        scheduleValue.textContent = scheduleLabel;

        scheduleEl.append(scheduleTitle, scheduleValue);
        card.appendChild(scheduleEl);
      }

      const footer = document.createElement("footer");
      footer.className = "mentor-vitrin-card-footer";
      const priceLabel = document.createElement("span");
      priceLabel.className = "mentor-vitrin-card-price-label";
      priceLabel.textContent = "Liste fiyatı";
      const priceEl = document.createElement("span");
      priceEl.className = "mentor-vitrin-card-price";
      priceEl.textContent = formatPriceTry(price) || "Fiyat belirtilmedi";
      if (!formatPriceTry(price)) priceEl.classList.add("mentor-vitrin-card-price--muted");
      footer.append(priceLabel, priceEl);

      const capacityEl = createPackageCapacityEl(capacity, filledCount);
      if (capacityEl) footer.appendChild(capacityEl);

      const remaining = getRemainingCapacity(capacity, filledCount);
      const isFull = remaining !== null && remaining <= 0;

      if (showBuyButton && !isFull && mentorAcceptsPayments) {
        const buyBtn = document.createElement("button");
        buyBtn.type = "button";
        buyBtn.className = "mentor-vitrin-buy-btn";
        buyBtn.textContent = "Satın al";
        buyBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void notifyPackageBuy({
            packageId,
            title,
            price,
            mentorId,
            mentorName,
            mentorAcceptsPayments,
          });
        });
        footer.appendChild(buyBtn);
      } else if (showBuyButton && !isFull && !mentorAcceptsPayments) {
        const busyBtn = document.createElement("span");
        busyBtn.className = "mentor-vitrin-buy-btn mentor-vitrin-buy-btn--disabled";
        busyBtn.textContent = "Meşgul";
        footer.appendChild(busyBtn);
      } else if (showBuyButton && isFull) {
        const fullBtn = document.createElement("span");
        fullBtn.className = "mentor-vitrin-buy-btn mentor-vitrin-buy-btn--disabled";
        fullBtn.textContent = "Kapasite doldu";
        footer.appendChild(fullBtn);
      }

      card.appendChild(footer);
    }

    return card;
  }

  function secPackageId(value) {
    const sec = window.RekabetliSecurity;
    return sec?.sanitizePackageId?.(value) || "";
  }

  function renderVitrinGrid(container, items, options) {
    if (!container) return;
    container.replaceChildren();
    container.classList.add("mentor-vitrin-grid", `mentor-vitrin-grid--${options.gridModifier}`);

    const rows = parseJsonArray(items).filter((item) => {
      if (options.kind === "package") return item?.title?.trim();
      return item?.title?.trim() || item?.description?.trim() || item?.content?.trim();
    });

    if (!rows.length) {
      renderEmptyState(container, options.emptyText);
      return;
    }

    rows.forEach((item, index) => {
      const body =
        options.kind === "package" ? item.content : item.description ?? item.content;
      const packageId = options.kind === "package" ? secPackageId(item.id) : "";
      const filledCount =
        options.kind === "package" && options.packageFillCounts && packageId
          ? options.packageFillCounts.get(packageId) || 0
          : 0;
      if (options.kind === "package" && !packageId) return;
      container.appendChild(
        createVitrinCard({
          kind: options.kind,
          title: item.title,
          body,
          accent: resolveItemAccent(item, options.kind, index),
          price: options.kind === "package" ? item.price : null,
          showBuyButton: options.kind === "package" && options.showBuyButton !== false,
          packageId: packageId || null,
          itemId: item?.id || null,
          mentorId: options.mentorId || null,
          mentorName: options.mentorName || null,
          capacity: options.kind === "package" ? item.capacity : null,
          filledCount,
          meetingPeriod: options.kind === "package" ? item.meeting_period : null,
          meetingCount: options.kind === "package" ? item.meeting_count : null,
          mentorAcceptsPayments: options.mentorAcceptsPayments !== false,
        }),
      );
    });
  }

  function renderVitrinBranches(container, items, emptyText = "Henüz branş eklenmemiş.") {
    renderVitrinGrid(container, items, { kind: "branch", gridModifier: "branches", emptyText });
  }

  function renderVitrinLessons(container, items, emptyText = "Henüz özel ders eklenmemiş.") {
    renderVitrinGrid(container, items, { kind: "lesson", gridModifier: "lessons", emptyText });
  }

  function renderVitrinPackages(
    container,
    packages,
    emptyText = "Henüz paket eklenmemiş.",
    options = {},
  ) {
    renderVitrinGrid(container, packages, {
      kind: "package",
      gridModifier: "packages",
      emptyText,
      showBuyButton: options.showBuyButton !== false,
      mentorId: options.mentorId || null,
      mentorName: options.mentorName || null,
      packageFillCounts: options.packageFillCounts || null,
      mentorAcceptsPayments: options.mentorAcceptsPayments !== false,
    });
  }

  function renderReadonlyDetailList(container, items, emptyText, kind = "branch") {
    if (kind === "lesson") renderVitrinLessons(container, items, emptyText);
    else renderVitrinBranches(container, items, emptyText);
  }

  function renderReadonlyPackages(container, packages) {
    renderVitrinPackages(container, packages);
  }

  window.RekabetliMentorVitrin = {
    isValidMentorId,
    mentorPublicUrl,
    getInitials,
    itemTitles,
    excerptText,
    formatPriceTry,
    getLowestPackagePrice,
    formatStartingPriceLabel,
    sanitizeCapacity,
    sanitizeMeetingPeriod,
    sanitizeMeetingCount,
    normalizePackageMeetings,
    formatMeetingScheduleLabel,
    MEETING_PERIOD_LABELS,
    MEETING_PLATFORMS,
    sanitizeMeetingPlatform,
    sanitizeMeetingLink,
    isGoogleMeetUrl,
    isZoomMeetingUrl,
    hasConsultationMeetingLink,
    sanitizePayoutAccountHolder,
    sanitizePayoutBankName,
    sanitizeTurkishIban,
    formatTurkishIbanDisplay,
    formatIbanDraftDisplay,
    hasPayoutBankDetails,
    isVitrinActive,
    normalizeVitrinReviewStatus,
    isVitrinReviewApproved,
    vitrinReviewStatusLabel,
    vitrinAvailabilityLabel,
    updateVitrinAvailabilityBadge,
    mountVitrinAvailabilityUI,
    subscribeVitrinAvailabilityWatch,
    restorePendingVitrinWatchFromStorage,
    startPackageCheckout,
    restorePendingPackageCheckoutFromStorage,
    getRemainingCapacity,
    fetchPackageFillCounts,
    notifyPackageBuy,
    normalizePageRow,
    isListableMentorPage,
    setSafeImage,
    MENTOR_ACCENT_PALETTE,
    sanitizeAccent,
    resolveVitrinAccent,
    applyVitrinShellAccent,
    resolveItemAccent,
    getAccentForKind,
    readAccentFromField,
    createAccentPicker,
    fillSummaryList,
    createSummaryChip,
    fillAboutContent,
    renderVitrinBranches,
    renderVitrinLessons,
    renderVitrinPackages,
    renderReadonlyDetailList,
    renderReadonlyPackages,
  };
})();
