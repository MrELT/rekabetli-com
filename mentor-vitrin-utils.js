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

  async function notifyPackageBuy(context) {
    const sec = window.RekabetliSecurity;
    const packageId = sec?.sanitizePackageId?.(context?.packageId) || "";
    const mentorId = isValidMentorId(context?.mentorId) ? String(context.mentorId).trim() : "";
    if (!packageId || !mentorId) return;

    const title = sec?.sanitizeBranchText
      ? sec.sanitizeBranchText(context?.title, 120)
      : String(context?.title || "Paket").trim().slice(0, 120) || "Paket";
    const message = `“${title}” paketi için online ödeme yakında aktif edilecektir. İlgileniyorsanız ön talep oluşturabilirsiniz.`;
    const safeContext = {
      packageId,
      mentorId,
      mentorName: sec?.sanitizePersonName?.(context?.mentorName, 120) || "Mentör",
      title,
      price:
        context?.price != null && Number.isFinite(Number(context.price)) && Number(context.price) >= 0
          ? Number(context.price)
          : null,
    };
    if (typeof window.rekabetliAlert === "function") {
      const result = await window.rekabetliAlert({
        title: "Satın alma",
        message,
        confirmLabel: "Tamam",
        secondaryLabel: "Ön talep et",
      });
      if (result === "secondary" && window.RekabetliPackageRequest?.open) {
        void window.RekabetliPackageRequest.open(safeContext);
      }
      return;
    }
    window.alert(message);
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
      isMentor: Boolean(profile.is_mentor),
    };
  }

  function isListableMentorPage(row) {
    const page = normalizePageRow(row);
    if (!page || !page.isMentor || !page.displayName) return false;
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
    mentorId = null,
    mentorName = null,
    capacity = null,
    filledCount = 0,
  }) {
    const card = document.createElement("article");
    card.className = `mentor-vitrin-card mentor-vitrin-card--${kind}`;
    if (accent) card.dataset.accent = accent;

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

      if (showBuyButton && !isFull) {
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
          });
        });
        footer.appendChild(buyBtn);
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
          mentorId: options.mentorId || null,
          mentorName: options.mentorName || null,
          capacity: options.kind === "package" ? item.capacity : null,
          filledCount,
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
