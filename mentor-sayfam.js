(function initMentorSayfam() {
  const supabase = window.getSupabase?.() || window.sb;
  if (!supabase) {
    console.error("[rekabetli] Supabase yüklenemedi.");
    return;
  }

  const AVATAR_BUCKET = "avatars";
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

  const statusEl = document.getElementById("mentor-sayfam-status");
  const showcaseEl = document.getElementById("mentor-showcase");
  const displayNameEl = document.getElementById("mentor-display-name");
  const vitrinAvailabilityBadgeEl = document.getElementById("mentor-vitrin-availability-badge");
  const vitrinAvailabilityToggleBtn = document.getElementById("mentor-vitrin-availability-toggle");
  const photoImg = document.getElementById("mentor-photo-img");
  const photoFallback = document.getElementById("mentor-photo-fallback");
  const photoEditBtn = document.getElementById("mentor-photo-edit");
  const photoInput = document.getElementById("mentor-photo-input");
  const vitrinAccentPickerSlot = document.getElementById("mentor-vitrin-accent-picker-slot");
  const vitrinAccentStatusEl = document.getElementById("mentor-vitrin-accent-status");
  const aboutContentEl = document.getElementById("mentor-about-content");
  const aboutEditBtn = document.getElementById("mentor-about-edit");
  const aboutModal = document.getElementById("mentor-about-modal");
  const aboutModalClose = document.getElementById("mentor-about-modal-close");
  const aboutCancelBtn = document.getElementById("mentor-about-cancel");
  const aboutForm = document.getElementById("mentor-about-form");
  const aboutInput = document.getElementById("mentor-about-input");
  const messageEl = document.getElementById("mentor-page-message");
  const summaryBranchesEl = document.getElementById("mentor-summary-branches");
  const summaryLessonsEl = document.getElementById("mentor-summary-lessons");
  const branchesListEl = document.getElementById("mentor-branches-list");
  const lessonsListEl = document.getElementById("mentor-lessons-list");
  const addBranchBtn = document.getElementById("mentor-add-branch");
  const addLessonBtn = document.getElementById("mentor-add-lesson");
  const branchesVitrinEl = document.getElementById("mentor-vitrin-branches");
  const lessonsVitrinEl = document.getElementById("mentor-vitrin-lessons");
  const packagesListEl = document.getElementById("mentor-packages-list");
  const packagesVitrinEl = document.getElementById("mentor-vitrin-packages");
  const addPackageBtn = document.getElementById("mentor-add-package");
  const toolbarEl = document.getElementById("mentor-sayfam-toolbar");
  const previewToggleBtn = document.getElementById("mentor-preview-toggle-btn");
  const toolbarLabelEl = document.getElementById("mentor-sayfam-toolbar-label");

  const MAX_ITEMS = 12;
  const MAX_TITLE = 120;
  const MAX_DESC = 800;
  const MAX_PACKAGE_CONTENT = 1200;
  const PRICE_INFO_TEXT =
    "Girdiğiniz liste fiyatından yalnızca %20 platform komisyonu düşülür. Kart ve kur dönüşümü ücretleri platform tarafından karşılanır.";

  let currentUser = null;
  let displayName = "Mentör";
  let pageData = {
    photo_url: null,
    vitrin_accent: null,
    about: null,
    branches: [],
    private_lessons: [],
    packages: [],
    meeting_platform: "google_meet",
    meeting_link: null,
    payout_ready: false,
    vitrin_active: true,
    vitrin_review_status: "draft",
    vitrin_review_note: null,
    payout_account_holder: null,
    payout_bank_name: null,
    payout_iban: null,
  };
  let saving = false;
  let previewMode = false;
  let payoutAccordionPinnedOpen = false;
  let lastWalletSummary = null;
  const WALLET_LIST_PAGE_SIZE = 3;
  let walletTransactionsCache = [];
  let walletPayoutRequestsCache = [];
  let walletTransactionPage = 0;
  let walletPayoutPage = 0;
  let activeBranchEditorId = null;
  let activeLessonEditorId = null;
  let activePackageEditorId = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setMessage(text, isError = false) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.classList.toggle("empty", !text);
    messageEl.classList.toggle("profile-message-error", Boolean(isError));
  }

  function setCardInlineMessage(card, text, isError = false) {
    const el = card?.querySelector(".mentor-item-inline-message");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("empty", !text);
    el.classList.toggle("profile-message-error", Boolean(text && isError));
  }

  function getInitials(name) {
    const parts = String(name || "?")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.[0] ?? "?").toUpperCase();
  }

  function setImage(el, url, options = {}) {
    if (!el) return;
    const sec = window.RekabetliSecurity;
    if (url && sec?.setImgSrc) {
      sec.setImgSrc(el, url, { allowBlob: true });
      el.hidden = false;
      el.style.display = "block";
      if (options.alt) el.alt = sec.sanitizePersonName?.(options.alt, 120) || "Mentör";
      return;
    }
    el.hidden = true;
    el.style.display = "none";
    el.removeAttribute("src");
  }

  function setFallbackVisible(fallbackEl, visible) {
    if (!fallbackEl) return;
    fallbackEl.hidden = !visible;
    fallbackEl.style.display = visible ? "" : "none";
  }

  function newItemId() {
    return crypto.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function sanitizeItemId(value) {
    const sec = window.RekabetliSecurity;
    const id = sec?.sanitizePackageId?.(value) || "";
    return id || newItemId();
  }

  function rejectMarkupInRawFields(...values) {
    const sec = window.RekabetliSecurity;
    if (sec?.containsMarkupAttempt?.(values.join(" "))) {
      return "HTML, script veya geçersiz bağlantı içeriği kullanılamaz.";
    }
    return null;
  }

  function sanitizeTitle(value) {
    const sec = window.RekabetliSecurity;
    if (sec?.sanitizeBranchText) return sec.sanitizeBranchText(value, MAX_TITLE);
    return String(value || "").trim().slice(0, MAX_TITLE);
  }

  function sanitizeDescription(value) {
    const sec = window.RekabetliSecurity;
    if (sec?.sanitizePlainText) return sec.sanitizePlainText(value, MAX_DESC);
    return String(value || "").trim().slice(0, MAX_DESC);
  }

  function normalizeItems(raw, kind = "branch") {
    const vitrin = window.RekabetliMentorVitrin;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item, index) => ({
        id: sanitizeItemId(item?.id),
        title: sanitizeTitle(item?.title),
        description: sanitizeDescription(item?.description),
        accent:
          vitrin?.sanitizeAccent?.(item?.accent) ||
          vitrin?.getAccentForKind?.(kind, index) ||
          null,
      }))
      .filter((item) => item.title || item.description)
      .slice(0, MAX_ITEMS);
  }

  function sanitizePackageContent(value) {
    const sec = window.RekabetliSecurity;
    if (sec?.sanitizePlainText) return sec.sanitizePlainText(value, MAX_PACKAGE_CONTENT);
    return String(value || "").trim().slice(0, MAX_PACKAGE_CONTENT);
  }

  function sanitizePrice(value) {
    const raw = String(value ?? "").trim().replace(/\s/g, "");
    if (!raw) return null;
    const normalized = raw.replace(/\./g, "").replace(",", ".");
    const num = Number(normalized);
    if (!Number.isFinite(num) || num < 0 || num > 9_999_999) return null;
    return Math.round(num * 100) / 100;
  }

  function formatPriceForInput(price) {
    if (price == null || Number.isNaN(Number(price))) return "";
    return Number(price).toLocaleString("tr-TR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  function normalizePackages(raw) {
    const vitrin = window.RekabetliMentorVitrin;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item, index) => {
        const priceRaw = item?.price;
        let price = null;
        if (priceRaw !== null && priceRaw !== undefined && priceRaw !== "") {
          if (typeof priceRaw === "number" && Number.isFinite(priceRaw)) {
            price =
              priceRaw >= 0 && priceRaw <= 9_999_999
                ? Math.round(priceRaw * 100) / 100
                : null;
          } else {
            price = sanitizePrice(priceRaw);
          }
        }
        return {
          id: sanitizeItemId(item?.id),
          title: sanitizeTitle(item?.title),
          content: sanitizePackageContent(item?.content ?? item?.description),
          price,
          capacity: vitrin?.sanitizeCapacity?.(item?.capacity) ?? null,
          ...(vitrin?.normalizePackageMeetings
            ? vitrin.normalizePackageMeetings(item)
            : { meeting_period: null, meeting_count: null }),
          accent:
            vitrin?.sanitizeAccent?.(item?.accent) ||
            vitrin?.getAccentForKind?.("package", index) ||
            null,
        };
      })
      .filter((item) => item.title || item.content || item.price != null)
      .slice(0, MAX_ITEMS);
  }

  function closeAllPriceInfoBoxes() {
    document.querySelectorAll(".mentor-price-info-box").forEach((box) => {
      box.hidden = true;
    });
  }

  function getCardSnapshot(card, kind) {
    if (kind === "package") {
      return JSON.stringify(readPackageFromCard(card));
    }
    return JSON.stringify(readItemFromCard(card));
  }

  function setCardSaveButtonState(saveBtn, state) {
    if (!saveBtn) return;
    saveBtn.dataset.state = state;
    saveBtn.classList.toggle("is-saved", state === "saved");
    if (state === "saved") {
      saveBtn.textContent = "Kaydedildi";
      saveBtn.disabled = true;
      return;
    }
    if (state === "saving") {
      saveBtn.textContent = "Kaydediliyor…";
      saveBtn.disabled = true;
      return;
    }
    saveBtn.textContent = "Kaydet";
    saveBtn.disabled = false;
  }

  function bindCardSaveButton(card, kind) {
    const saveBtn = card.querySelector(".mentor-item-save");
    if (!saveBtn) return;

    const syncSnapshotFromPage = () => {
      const itemId = card.dataset.itemId;
      if (kind === "package") {
        const item = pageData.packages.find((row) => row.id === itemId);
        if (!item) return;
        card.dataset.savedSnapshot = JSON.stringify({
          title: item.title || "",
          content: item.content || "",
          price: item.price ?? null,
          capacity: item.capacity ?? null,
          meeting_period: item.meeting_period ?? null,
          meeting_count: item.meeting_count ?? null,
          accent: item.accent || null,
        });
        return;
      }
      const key = kind === "branch" ? "branches" : "private_lessons";
      const item = pageData[key].find((row) => row.id === itemId);
      if (!item) return;
      card.dataset.savedSnapshot = JSON.stringify({
        title: item.title || "",
        description: item.description || "",
        accent: item.accent || null,
      });
    };

    syncSnapshotFromPage();
    const initial = JSON.parse(card.dataset.savedSnapshot || "{}");
    if (initial.title) {
      setCardSaveButtonState(saveBtn, "saved");
    }

    const markDirtyIfChanged = () => {
      const current = getCardSnapshot(card, kind);
      if (current !== card.dataset.savedSnapshot) {
        setCardSaveButtonState(saveBtn, "default");
      }
      setCardInlineMessage(card, "");
    };

    card.querySelectorAll(
      ".mentor-item-title, .mentor-item-desc, .mentor-item-price, .mentor-item-capacity, .mentor-item-meeting-count",
    ).forEach((el) => {
      el.addEventListener("input", markDirtyIfChanged);
    });
    card.querySelectorAll(".mentor-item-meeting-period, .mentor-item-meeting-count").forEach((el) => {
      el.addEventListener("change", markDirtyIfChanged);
    });

    const accentField = card.querySelector(".mentor-accent-field");
    if (accentField) {
      accentField.addEventListener("accent-change", markDirtyIfChanged);
    }
  }

  function markCardSaved(card, kind) {
    const saveBtn = card.querySelector(".mentor-item-save");
    const itemId = card.dataset.itemId;

    if (kind === "package") {
      const item = pageData.packages.find((row) => row.id === itemId);
      if (item) {
        card.dataset.savedSnapshot = JSON.stringify({
          title: item.title || "",
          content: item.content || "",
          price: item.price ?? null,
          capacity: item.capacity ?? null,
          meeting_period: item.meeting_period ?? null,
          meeting_count: item.meeting_count ?? null,
          accent: item.accent || null,
        });
      }
    } else {
      const key = kind === "branch" ? "branches" : "private_lessons";
      const item = pageData[key].find((row) => row.id === itemId);
      if (item) {
        card.dataset.savedSnapshot = JSON.stringify({
          title: item.title || "",
          description: item.description || "",
          accent: item.accent || null,
        });
      }
    }

    setCardSaveButtonState(saveBtn, "saved");
  }

  function createItemCard(item, kind, index = 0) {
    const card = document.createElement("article");
    card.className = `mentor-item-card mentor-item-card--${kind}`;
    card.dataset.itemId = item.id;

    const titleLabel = document.createElement("label");
    titleLabel.textContent = kind === "branch" ? "Branş başlığı" : "Ders adı";
    titleLabel.setAttribute("for", `${kind}-title-${item.id}`);

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.id = `${kind}-title-${item.id}`;
    titleInput.className = "mentor-item-title";
    titleInput.maxLength = MAX_TITLE;
    titleInput.value = item.title || "";
    titleInput.placeholder = kind === "branch" ? "Örn: Olimpiyat Fiziği" : "Örn: İleri Calculus";

    const descLabel = document.createElement("label");
    descLabel.textContent = "Açıklama";
    descLabel.setAttribute("for", `${kind}-desc-${item.id}`);

    const descInput = document.createElement("textarea");
    descInput.id = `${kind}-desc-${item.id}`;
    descInput.className = "mentor-item-desc";
    descInput.rows = 3;
    descInput.maxLength = MAX_DESC;
    descInput.value = item.description || "";
    descInput.placeholder =
      kind === "branch"
        ? "Bu branşta nasıl mentörlük verdiğinizi kısaca anlatın…"
        : "Ders içeriği, seviye ve hedef kitlenizi yazın…";

    const actions = document.createElement("div");
    actions.className = "mentor-item-actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "mentor-item-save";
    saveBtn.textContent = "Kaydet";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "secondary mentor-item-delete";
    deleteBtn.textContent = "Sil";

    const inlineMessage = document.createElement("p");
    inlineMessage.className = "profile-message mentor-item-inline-message empty";
    inlineMessage.setAttribute("role", "status");

    actions.append(saveBtn, deleteBtn);

    const vitrin = window.RekabetliMentorVitrin;
    card.append(titleLabel, titleInput, descLabel, descInput);
    if (vitrin?.createAccentPicker) {
      const picker = vitrin.createAccentPicker({
        selectedAccent: item.accent,
        kind,
        index,
        onChange: (accent) => {
          applyCardAccentPreview(card, accent);
          picker.dispatchEvent(new CustomEvent("accent-change", { bubbles: true }));
        },
      });
      applyCardAccentPreview(card, vitrin.resolveItemAccent(item, kind, index));
      card.appendChild(picker);
    }
    card.append(inlineMessage, actions);

    saveBtn.addEventListener("click", () => {
      void saveItemFromCard(kind, card);
    });

    deleteBtn.addEventListener("click", () => {
      void deleteItem(kind, item.id);
    });

    bindCardSaveButton(card, kind);
    return card;
  }

  function syncPackageMeetingFields(card) {
    const period = card.querySelector(".mentor-item-meeting-period")?.value || "";
    const countField = card.querySelector(".mentor-meeting-count-field");
    const countSelect = card.querySelector(".mentor-item-meeting-count");
    const isRecurring = period && period !== "once";
    countField?.classList.toggle("is-disabled", !isRecurring);
    if (countSelect) countSelect.disabled = !isRecurring;
  }

  function createPackageMeetingFields(item) {
    const vitrin = window.RekabetliMentorVitrin;
    const wrap = document.createElement("div");
    wrap.className = "mentor-meeting-field";

    const periodField = document.createElement("div");
    periodField.className = "mentor-meeting-period-field";

    const periodLabel = document.createElement("label");
    periodLabel.textContent = "Görüşme sıklığı *";
    periodLabel.setAttribute("for", `package-meeting-period-${item.id}`);

    const periodSelect = document.createElement("select");
    periodSelect.id = `package-meeting-period-${item.id}`;
    periodSelect.className = "mentor-item-meeting-period mentor-meeting-period";

    const periodPlaceholder = document.createElement("option");
    periodPlaceholder.value = "";
    periodPlaceholder.textContent = "Seçin";
    periodSelect.appendChild(periodPlaceholder);

    const periodOptions = [
      ["once", vitrin?.MEETING_PERIOD_LABELS?.once || "Tek sefer"],
      ["week", vitrin?.MEETING_PERIOD_LABELS?.week || "Haftada"],
      ["month", vitrin?.MEETING_PERIOD_LABELS?.month || "Ayda"],
      ["year", vitrin?.MEETING_PERIOD_LABELS?.year || "Yılda"],
    ];

    periodOptions.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      periodSelect.appendChild(option);
    });

    if (item.meeting_period) {
      periodSelect.value = item.meeting_period;
    }

    const periodHint = document.createElement("p");
    periodHint.className = "mentor-meeting-field-hint";
    periodHint.textContent = "Görüşmelerin tekrar aralığını seçin.";

    periodField.append(periodLabel, periodSelect, periodHint);

    const countField = document.createElement("div");
    countField.className = "mentor-meeting-count-field";

    const countLabel = document.createElement("label");
    countLabel.textContent = "Sıklık";
    countLabel.setAttribute("for", `package-meeting-count-${item.id}`);

    const countSelect = document.createElement("select");
    countSelect.id = `package-meeting-count-${item.id}`;
    countSelect.className = "mentor-item-meeting-count";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Görüşme sayısı seçin";
    countSelect.appendChild(placeholder);

    for (let count = 1; count <= 24; count += 1) {
      const option = document.createElement("option");
      option.value = String(count);
      option.textContent = String(count);
      countSelect.appendChild(option);
    }

    if (item.meeting_count != null) {
      countSelect.value = String(item.meeting_count);
    }

    const countHint = document.createElement("p");
    countHint.className = "mentor-meeting-field-hint";
    countHint.textContent = "Tek sefer dışında bir seçenekte görüşme sayısını belirtin.";

    countField.append(countLabel, countSelect, countHint);
    wrap.append(periodField, countField);

    periodSelect.addEventListener("change", () => {
      syncPackageMeetingFields(wrap.closest(".mentor-package-card") || wrap.parentElement);
    });

    return wrap;
  }

  function createPackageCard(item, index = 0) {
    const card = document.createElement("article");
    card.className = "mentor-item-card mentor-package-card";
    card.dataset.itemId = item.id;

    const titleLabel = document.createElement("label");
    titleLabel.textContent = "Paket başlığı";
    titleLabel.setAttribute("for", `package-title-${item.id}`);

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.id = `package-title-${item.id}`;
    titleInput.className = "mentor-item-title";
    titleInput.maxLength = MAX_TITLE;
    titleInput.value = item.title || "";
    titleInput.placeholder = "Örn: 4 Haftalık Olimpiyat Hazırlık";

    const contentLabel = document.createElement("label");
    contentLabel.textContent = "İçerik";
    contentLabel.setAttribute("for", `package-content-${item.id}`);

    const contentInput = document.createElement("textarea");
    contentInput.id = `package-content-${item.id}`;
    contentInput.className = "mentor-item-desc";
    contentInput.rows = 4;
    contentInput.maxLength = MAX_PACKAGE_CONTENT;
    contentInput.value = item.content || "";
    contentInput.placeholder = "Pakette neler olduğunu, oturum sayısı ve kapsamı yazın…";

    const priceWrap = document.createElement("div");
    priceWrap.className = "mentor-price-field";

    const priceLabelRow = document.createElement("div");
    priceLabelRow.className = "mentor-price-label-row";

    const priceLabel = document.createElement("label");
    priceLabel.textContent = "Fiyat (₺)";
    priceLabel.setAttribute("for", `package-price-${item.id}`);

    const priceInfoBtn = document.createElement("button");
    priceInfoBtn.type = "button";
    priceInfoBtn.className = "mentor-info-btn";
    priceInfoBtn.setAttribute("aria-label", "Fiyat bilgisi");
    priceInfoBtn.title = "Fiyat bilgisi";
    priceInfoBtn.textContent = "ℹ️";

    const priceInput = document.createElement("input");
    priceInput.type = "text";
    priceInput.inputMode = "decimal";
    priceInput.id = `package-price-${item.id}`;
    priceInput.className = "mentor-item-price";
    priceInput.maxLength = 16;
    priceInput.value = formatPriceForInput(item.price);
    priceInput.placeholder = "Örn: 2.500";

    const priceInfoBox = document.createElement("div");
    priceInfoBox.className = "mentor-price-info-box";
    priceInfoBox.hidden = true;
    priceInfoBox.setAttribute("role", "note");

    const priceInfoText = document.createElement("p");
    priceInfoText.textContent = PRICE_INFO_TEXT;

    const priceInfoClose = document.createElement("button");
    priceInfoClose.type = "button";
    priceInfoClose.className = "mentor-price-info-close";
    priceInfoClose.textContent = "Tamam";

    priceInfoBox.append(priceInfoText, priceInfoClose);
    priceLabelRow.append(priceLabel, priceInfoBtn);
    priceWrap.append(priceLabelRow, priceInput, priceInfoBox);

    priceInfoBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = priceInfoBox.hidden;
      closeAllPriceInfoBoxes();
      priceInfoBox.hidden = !willOpen;
    });

    priceInfoClose.addEventListener("click", () => {
      priceInfoBox.hidden = true;
    });

    const capacityWrap = document.createElement("div");
    capacityWrap.className = "mentor-capacity-field";

    const capacityLabel = document.createElement("label");
    capacityLabel.textContent = "Kapasite (kişi)";
    capacityLabel.setAttribute("for", `package-capacity-${item.id}`);

    const capacityInput = document.createElement("input");
    capacityInput.type = "number";
    capacityInput.inputMode = "numeric";
    capacityInput.id = `package-capacity-${item.id}`;
    capacityInput.className = "mentor-item-capacity";
    capacityInput.min = "1";
    capacityInput.max = "9999";
    capacityInput.step = "1";
    capacityInput.value = item.capacity != null ? String(item.capacity) : "";
    capacityInput.placeholder = "Örn: 10";

    const capacityHint = document.createElement("p");
    capacityHint.className = "mentor-capacity-hint";
    capacityHint.textContent = "Boş bırakılırsa öğrencilere kapasite gösterilmez.";

    capacityWrap.append(capacityLabel, capacityInput, capacityHint);

    const meetingWrap = createPackageMeetingFields(item);

    const metaRow = document.createElement("div");
    metaRow.className = "mentor-package-meta-row";
    metaRow.append(priceWrap, capacityWrap);

    const actions = document.createElement("div");
    actions.className = "mentor-item-actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "mentor-item-save";
    saveBtn.textContent = "Kaydet";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "secondary mentor-item-delete";
    deleteBtn.textContent = "Sil";

    const inlineMessage = document.createElement("p");
    inlineMessage.className = "profile-message mentor-item-inline-message empty";
    inlineMessage.setAttribute("role", "status");

    actions.append(saveBtn, deleteBtn);

    const vitrin = window.RekabetliMentorVitrin;
    card.append(titleLabel, titleInput, contentLabel, contentInput, meetingWrap, metaRow);
    if (vitrin?.createAccentPicker) {
      const picker = vitrin.createAccentPicker({
        selectedAccent: item.accent,
        kind: "package",
        index,
        onChange: (accent) => {
          applyCardAccentPreview(card, accent);
          picker.dispatchEvent(new CustomEvent("accent-change", { bubbles: true }));
        },
      });
      applyCardAccentPreview(card, vitrin.resolveItemAccent(item, "package", index));
      card.appendChild(picker);
    }
    card.append(inlineMessage, actions);

    saveBtn.addEventListener("click", () => {
      void savePackageFromCard(card);
    });

    deleteBtn.addEventListener("click", () => {
      void deletePackage(item.id);
    });

    bindCardSaveButton(card, "package");
    syncPackageMeetingFields(card);
    return card;
  }

  function focusPackageEditor() {
    const editorZone = document.querySelector(".mentor-about-section--packages .mentor-editor-zone");
    editorZone?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function focusItemEditor(kind) {
    const sectionClass = kind === "branch" ? "branches" : "lessons";
    const editorZone = document.querySelector(`.mentor-about-section--${sectionClass} .mentor-editor-zone`);
    editorZone?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function getActiveItemEditorId(kind) {
    return kind === "branch" ? activeBranchEditorId : activeLessonEditorId;
  }

  function setActiveItemEditorId(kind, id) {
    if (kind === "branch") activeBranchEditorId = id || null;
    else activeLessonEditorId = id || null;
  }

  function renderItemEditButtons(kind) {
    const container = kind === "branch" ? branchesVitrinEl : lessonsVitrinEl;
    if (!container) return;
    const cards = container.querySelectorAll(`.mentor-vitrin-card--${kind}`);
    cards.forEach((card) => {
      const itemId = card.dataset.itemId || "";
      if (!itemId) return;

      let editBtn = card.querySelector(".mentor-vitrin-item-edit-btn");
      if (!editBtn) {
        editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "mentor-edit-btn mentor-vitrin-item-edit-btn";
        editBtn.setAttribute("aria-label", kind === "branch" ? "Branşı düzenle" : "Dersi düzenle");
        editBtn.title = kind === "branch" ? "Branşı düzenle" : "Dersi düzenle";
        editBtn.textContent = "✏️";
        editBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          setActiveItemEditorId(kind, itemId);
          renderItemEditors();
          renderItemEditButtons(kind);
          focusItemEditor(kind);
        });
        card.appendChild(editBtn);
      }

      editBtn.classList.toggle("is-active", itemId === getActiveItemEditorId(kind));
    });
  }

  function renderPackageEditButtons() {
    if (!packagesVitrinEl) return;
    const cards = packagesVitrinEl.querySelectorAll(".mentor-vitrin-card--package");
    cards.forEach((card) => {
      const packageId = card.dataset.packageId || "";
      if (!packageId) return;

      let editBtn = card.querySelector(".mentor-vitrin-package-edit-btn");
      if (!editBtn) {
        editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "mentor-edit-btn mentor-vitrin-package-edit-btn";
        editBtn.setAttribute("aria-label", "Paketi düzenle");
        editBtn.title = "Paketi düzenle";
        editBtn.textContent = "✏️";
        editBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          activePackageEditorId = packageId;
          renderItemEditors();
          renderPackageEditButtons();
          focusPackageEditor();
        });
        card.appendChild(editBtn);
      }

      editBtn.classList.toggle("is-active", packageId === activePackageEditorId);
    });
  }

  function readPackageFromCard(card) {
    const vitrin = window.RekabetliMentorVitrin;
    const title = sanitizeTitle(card.querySelector(".mentor-item-title")?.value);
    const content = sanitizePackageContent(card.querySelector(".mentor-item-desc")?.value);
    const price = sanitizePrice(card.querySelector(".mentor-item-price")?.value);
    const capacity =
      window.RekabetliMentorVitrin?.sanitizeCapacity?.(
        card.querySelector(".mentor-item-capacity")?.value,
      ) ?? null;
    const meeting_period =
      vitrin?.sanitizeMeetingPeriod?.(card.querySelector(".mentor-item-meeting-period")?.value) ??
      null;
    let meeting_count = null;
    if (meeting_period && meeting_period !== "once") {
      meeting_count =
        vitrin?.sanitizeMeetingCount?.(card.querySelector(".mentor-item-meeting-count")?.value) ??
        null;
    }
    const accent = vitrin?.readAccentFromField?.(card) || null;
    return { title, content, price, capacity, meeting_period, meeting_count, accent };
  }

  function readItemFromCard(card) {
    const vitrin = window.RekabetliMentorVitrin;
    const title = sanitizeTitle(card.querySelector(".mentor-item-title")?.value);
    const description = sanitizeDescription(card.querySelector(".mentor-item-desc")?.value);
    const accent = vitrin?.readAccentFromField?.(card) || null;
    return { title, description, accent };
  }

  function applyCardAccentPreview(card, accent) {
    if (accent) card.dataset.accent = accent;
    else delete card.dataset.accent;
  }

  function renderItemEditors() {
    if (branchesListEl) {
      branchesListEl.replaceChildren();
      if (!pageData.branches.length) {
        activeBranchEditorId = null;
        const empty = document.createElement("p");
        empty.className = "mentor-items-empty";
        empty.textContent = "Henüz branş eklemediniz.";
        branchesListEl.appendChild(empty);
      } else {
        const hasActiveBranch = pageData.branches.some((item) => item.id === activeBranchEditorId);
        if (!hasActiveBranch) activeBranchEditorId = null;
        if (!activeBranchEditorId) {
          const empty = document.createElement("p");
          empty.className = "mentor-items-empty";
          empty.textContent = "Düzenlemek için yukarıdaki branşta ✏️ simgesine tıklayın.";
          branchesListEl.appendChild(empty);
        } else {
          const selectedIndex = pageData.branches.findIndex((item) => item.id === activeBranchEditorId);
          const selectedItem = selectedIndex >= 0 ? pageData.branches[selectedIndex] : null;
          if (selectedItem) {
            branchesListEl.appendChild(createItemCard(selectedItem, "branch", selectedIndex));
          }
        }
      }
    }

    if (lessonsListEl) {
      lessonsListEl.replaceChildren();
      if (!pageData.private_lessons.length) {
        activeLessonEditorId = null;
        const empty = document.createElement("p");
        empty.className = "mentor-items-empty";
        empty.textContent = "Henüz özel ders eklemediniz.";
        lessonsListEl.appendChild(empty);
      } else {
        const hasActiveLesson = pageData.private_lessons.some((item) => item.id === activeLessonEditorId);
        if (!hasActiveLesson) activeLessonEditorId = null;
        if (!activeLessonEditorId) {
          const empty = document.createElement("p");
          empty.className = "mentor-items-empty";
          empty.textContent = "Düzenlemek için yukarıdaki derste ✏️ simgesine tıklayın.";
          lessonsListEl.appendChild(empty);
        } else {
          const selectedIndex = pageData.private_lessons.findIndex((item) => item.id === activeLessonEditorId);
          const selectedItem = selectedIndex >= 0 ? pageData.private_lessons[selectedIndex] : null;
          if (selectedItem) {
            lessonsListEl.appendChild(createItemCard(selectedItem, "lesson", selectedIndex));
          }
        }
      }
    }

    if (addBranchBtn) {
      addBranchBtn.disabled = pageData.branches.length >= MAX_ITEMS;
    }
    if (addLessonBtn) {
      addLessonBtn.disabled = pageData.private_lessons.length >= MAX_ITEMS;
    }

    if (packagesListEl) {
      packagesListEl.replaceChildren();
      if (!pageData.packages.length) {
        activePackageEditorId = null;
        const empty = document.createElement("p");
        empty.className = "mentor-items-empty";
        empty.textContent = "Henüz paket eklemediniz.";
        packagesListEl.appendChild(empty);
      } else {
        const hasActive = pageData.packages.some((item) => item.id === activePackageEditorId);
        if (!hasActive) activePackageEditorId = null;

        if (!activePackageEditorId) {
          const empty = document.createElement("p");
          empty.className = "mentor-items-empty";
          empty.textContent = "Düzenlemek için yukarıdaki pakette ✏️ simgesine tıklayın.";
          packagesListEl.appendChild(empty);
        } else {
          const selectedIndex = pageData.packages.findIndex((item) => item.id === activePackageEditorId);
          const selectedItem = selectedIndex >= 0 ? pageData.packages[selectedIndex] : null;
          if (selectedItem) {
            const card = createPackageCard(selectedItem, selectedIndex);
            packagesListEl.appendChild(card);
          }
        }
      }
    }

    if (addPackageBtn) {
      addPackageBtn.disabled = pageData.packages.length >= MAX_ITEMS;
    }
  }

  function renderSummaries() {
    const vitrin = window.RekabetliMentorVitrin;
    if (!vitrin) return;
    vitrin.fillSummaryList(
      summaryBranchesEl,
      pageData.branches,
      "Henüz branş eklenmedi",
      "branch",
    );
    vitrin.fillSummaryList(
      summaryLessonsEl,
      pageData.private_lessons,
      "Henüz ders eklenmedi",
      "lesson",
    );
  }

  async function saveItemFromCard(kind, card) {
    const itemId = card.dataset.itemId;
    const saveBtn = card.querySelector(".mentor-item-save");
    const { title, description, accent } = readItemFromCard(card);
    const markupError = rejectMarkupInRawFields(
      card.querySelector(".mentor-item-title")?.value,
      card.querySelector(".mentor-item-desc")?.value,
    );
    if (markupError) {
      setCardInlineMessage(card, markupError, true);
      return;
    }
    if (!title) {
      setCardInlineMessage(card, kind === "branch" ? "Branş başlığı gerekli." : "Ders adı gerekli.", true);
      return;
    }

    setCardInlineMessage(card, "");
    const key = kind === "branch" ? "branches" : "private_lessons";
    const items = [...pageData[key]];
    const index = items.findIndex((item) => item.id === itemId);
    const next = { id: itemId, title, description, accent };
    if (index >= 0) items[index] = next;
    else items.push(next);

    setCardSaveButtonState(saveBtn, "saving");
    const ok = await saveMentorPage({ [key]: items }, { quiet: true, refreshEditors: false });
    if (ok) {
      markCardSaved(card, kind);
      setMessage("");
    } else {
      setCardSaveButtonState(saveBtn, "default");
    }
  }

  async function deleteItem(kind, itemId) {
    if (kind === "branch" && activeBranchEditorId === itemId) activeBranchEditorId = null;
    if (kind === "lesson" && activeLessonEditorId === itemId) activeLessonEditorId = null;
    const key = kind === "branch" ? "branches" : "private_lessons";
    const items = pageData[key].filter((item) => item.id !== itemId);
    await saveMentorPage({ [key]: items }, { quiet: true });
  }

  async function addItem(kind) {
    const key = kind === "branch" ? "branches" : "private_lessons";
    if (pageData[key].length >= MAX_ITEMS) return;

    const vitrin = window.RekabetliMentorVitrin;
    const index = pageData[key].length;
    const item = {
      id: newItemId(),
      title: "",
      description: "",
      accent: vitrin?.getAccentForKind?.(kind, index) || null,
    };
    pageData[key] = [...pageData[key], item];
    setActiveItemEditorId(kind, item.id);
    renderItemEditors();
    renderSummaries();

    const listEl = kind === "branch" ? branchesListEl : lessonsListEl;
    const card = listEl?.querySelector(`[data-item-id="${item.id}"]`);
    card?.querySelector(".mentor-item-title")?.focus();
  }

  async function savePackageFromCard(card) {
    const itemId = card.dataset.itemId;
    const saveBtn = card.querySelector(".mentor-item-save");
    const { title, content, price, capacity, meeting_period, meeting_count, accent } =
      readPackageFromCard(card);
    const markupError = rejectMarkupInRawFields(
      card.querySelector(".mentor-item-title")?.value,
      card.querySelector(".mentor-item-desc")?.value,
      card.querySelector(".mentor-item-price")?.value,
      card.querySelector(".mentor-item-capacity")?.value,
      card.querySelector(".mentor-item-meeting-count")?.value,
    );
    if (markupError) {
      setCardInlineMessage(card, markupError, true);
      return;
    }
    if (!title) {
      setCardInlineMessage(card, "Paket başlığı gerekli.", true);
      return;
    }
    if (!meeting_period) {
      setCardInlineMessage(card, "Görüşme sıklığı seçimi zorunlu.", true);
      return;
    }
    if (price == null && card.querySelector(".mentor-item-price")?.value?.trim()) {
      setCardInlineMessage(card, "Geçerli bir fiyat girin.", true);
      return;
    }
    const capacityRaw = card.querySelector(".mentor-item-capacity")?.value?.trim();
    if (capacityRaw && capacity == null) {
      setCardInlineMessage(card, "Kapasite 1–9999 arasında tam sayı olmalı.", true);
      return;
    }
    if (
      meeting_period &&
      meeting_period !== "once" &&
      card.querySelector(".mentor-item-meeting-count")?.value?.trim() &&
      meeting_count == null
    ) {
      setCardInlineMessage(card, "Sıklık için 1–24 arasında görüşme sayısı seçin.", true);
      return;
    }
    if (meeting_period && meeting_period !== "once" && meeting_count == null) {
      setCardInlineMessage(card, "Tek sefer dışındaki seçeneklerde sıklık belirtmelisiniz.", true);
      return;
    }

    setCardInlineMessage(card, "");
    const items = [...pageData.packages];
    const index = items.findIndex((item) => item.id === itemId);
    const next = {
      id: itemId,
      title,
      content,
      price,
      capacity,
      meeting_period,
      meeting_count,
      accent,
    };
    if (index >= 0) items[index] = next;
    else items.push(next);

    setCardSaveButtonState(saveBtn, "saving");
    const ok = await saveMentorPage({ packages: items }, { quiet: true, refreshEditors: false });
    if (ok) {
      markCardSaved(card, "package");
      setMessage("");
    } else {
      setCardSaveButtonState(saveBtn, "default");
    }
  }

  async function deletePackage(itemId) {
    if (activePackageEditorId === itemId) activePackageEditorId = null;
    const items = pageData.packages.filter((item) => item.id !== itemId);
    await saveMentorPage({ packages: items }, { quiet: true });
  }

  async function addPackage() {
    if (pageData.packages.length >= MAX_ITEMS) return;

    const vitrin = window.RekabetliMentorVitrin;
    const index = pageData.packages.length;
    const item = {
      id: newItemId(),
      title: "",
      content: "",
      price: null,
      capacity: null,
      meeting_period: null,
      meeting_count: null,
      accent: vitrin?.getAccentForKind?.("package", index) || null,
    };
    pageData.packages = [...pageData.packages, item];
    activePackageEditorId = item.id;
    renderItemEditors();

    const card = packagesListEl?.querySelector(`[data-item-id="${item.id}"]`);
    card?.querySelector(".mentor-item-title")?.focus();
  }

  function renderVitrinAccent() {
    const vitrin = window.RekabetliMentorVitrin;
    if (!vitrin) return;
    vitrin.applyVitrinShellAccent(showcaseEl, pageData.vitrin_accent);
    if (!vitrinAccentPickerSlot) return;

    vitrinAccentPickerSlot.replaceChildren();
    const picker = vitrin.createAccentPicker({
      selectedAccent: pageData.vitrin_accent,
      kind: "branch",
      index: 0,
      onChange: (accent) => {
        void saveVitrinAccent(accent);
      },
    });
    picker.querySelector(".mentor-accent-label").textContent = "Arka plan rengi";
    vitrinAccentPickerSlot.appendChild(picker);
  }

  async function saveVitrinAccent(accent) {
    const vitrin = window.RekabetliMentorVitrin;
    const nextAccent = vitrin?.sanitizeAccent?.(accent) || accent;
    if (vitrinAccentStatusEl) vitrinAccentStatusEl.textContent = "Kaydediliyor…";

    const ok = await saveMentorPage({ vitrin_accent: nextAccent }, { quiet: true, refreshEditors: false });
    if (ok) {
      vitrin?.applyVitrinShellAccent?.(showcaseEl, pageData.vitrin_accent);
      if (vitrinAccentStatusEl) {
        vitrinAccentStatusEl.textContent = "Kaydedildi";
        window.setTimeout(() => {
          if (vitrinAccentStatusEl.textContent === "Kaydedildi") {
            vitrinAccentStatusEl.textContent = "";
          }
        }, 1800);
      }
    } else if (vitrinAccentStatusEl) {
      vitrinAccentStatusEl.textContent = "";
    }
  }

  function renderPhoto() {
    const url = pageData.photo_url;
    if (url) {
      setImage(photoImg, url, { alt: displayName });
      setFallbackVisible(photoFallback, false);
      return;
    }
    setImage(photoImg, null);
    if (photoFallback) {
      photoFallback.textContent = getInitials(displayName);
      setFallbackVisible(photoFallback, true);
    }
  }

  function renderAbout() {
    const vitrin = window.RekabetliMentorVitrin;
    if (vitrin?.fillAboutContent) {
      vitrin.fillAboutContent(aboutContentEl, pageData.about);
      return;
    }
    if (!aboutContentEl) return;
    aboutContentEl.replaceChildren();
    const text = pageData.about?.trim() || "";
    if (!text) {
      const empty = document.createElement("p");
      empty.className = "mentor-about-empty";
      empty.textContent = "Henüz bir açıklama eklemediniz.";
      aboutContentEl.appendChild(empty);
      return;
    }

    const paragraphs = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    paragraphs.forEach((block) => {
      const p = document.createElement("p");
      p.textContent = block;
      aboutContentEl.appendChild(p);
    });
  }

  function renderVitrinAvailability() {
    const vitrin = window.RekabetliMentorVitrin;
    const reviewApproved = vitrin?.isVitrinReviewApproved?.(pageData) === true;
    const active = pageData.vitrin_active !== false;
    vitrin?.updateVitrinAvailabilityBadge?.(vitrinAvailabilityBadgeEl, active);
    if (!vitrinAvailabilityToggleBtn) return;
    if (!reviewApproved) {
      vitrinAvailabilityToggleBtn.hidden = true;
      if (vitrinAvailabilityBadgeEl) vitrinAvailabilityBadgeEl.hidden = true;
      return;
    }
    vitrinAvailabilityToggleBtn.hidden = false;
    vitrinAvailabilityToggleBtn.disabled = saving;
    vitrinAvailabilityToggleBtn.textContent = active ? "Pasif yap" : "Aktif et";
    vitrinAvailabilityToggleBtn.setAttribute("aria-pressed", active ? "false" : "true");
  }

  function renderVitrinReviewPanel() {
    const vitrin = window.RekabetliMentorVitrin;
    const panel = document.getElementById("mentor-vitrin-publish");
    const badgeEl = document.getElementById("mentor-vitrin-review-badge");
    const descEl = document.getElementById("mentor-vitrin-publish-desc");
    const infoEl = document.getElementById("mentor-vitrin-publish-info");
    const consentsEl = document.getElementById("mentor-vitrin-consents");
    const submitBtn = document.getElementById("mentor-vitrin-submit-review");
    const noteEl = document.getElementById("mentor-vitrin-review-note");
    if (!panel || !vitrin) return;

    const status = vitrin.normalizeVitrinReviewStatus?.(pageData.vitrin_review_status) || "draft";
    const label = vitrin.vitrinReviewStatusLabel?.(status) || "Taslak";

    if (badgeEl) {
      badgeEl.hidden = false;
      badgeEl.textContent = label;
      badgeEl.className = `mentor-vitrin-review-badge is-${status}`;
    }

    if (noteEl) {
      const note = pageData.vitrin_review_note?.trim() || "";
      if (status === "rejected" && note) {
        noteEl.hidden = false;
        noteEl.textContent = `Red gerekçesi: ${note}`;
      } else {
        noteEl.hidden = true;
        noteEl.textContent = "";
      }
    }

    if (descEl) {
      if (status === "pending") {
        descEl.textContent =
          "Sayfanız admin incelemesinde. Onaylanana kadar vitrin listesinde görünmez; düzenlemeye devam edebilirsiniz.";
      } else if (status === "approved") {
        descEl.textContent =
          "Sayfanız onaylandı; mentör ünvanınız aktif. Ödeme hesabı ve görüşme bağlantısı paket satışları için gereklidir; aşağıdan Aktif/Meşgul durumunu yönetebilirsiniz.";
      } else if (status === "rejected") {
        descEl.textContent =
          "Sayfanız reddedildi. Gerekli düzenlemeleri yapıp koşulları tekrar kabul ederek incelemeye gönderebilirsiniz.";
      } else {
        descEl.textContent =
          "Vitrin alanlarını doldurduktan sonra koşulları kabul edip sayfanızı incelemeye gönderin. Onaylandığında mentör ünvanınız aktif olur.";
      }
    }

    if (infoEl) {
      if (status === "pending") {
        infoEl.hidden = false;
        infoEl.className = "mentor-vitrin-publish-info is-pending";
        infoEl.innerHTML =
          "<p class=\"mentor-vitrin-publish-info-title\">İnceleme süreci</p>" +
          "<p class=\"mentor-vitrin-publish-info-note\">Sayfanız admin ekibimiz tarafından inceleniyor. " +
          "Onaylandıktan sonra otomatik olarak aktive edilir ve mentör listesinde yayınlanır. " +
          "Bu süreçte düzenlemeye devam edebilirsiniz.</p>";
      } else if (status === "approved") {
        infoEl.hidden = false;
        infoEl.className = "mentor-vitrin-publish-info is-approved";
        infoEl.innerHTML =
          "<p class=\"mentor-vitrin-publish-info-title\">Sayfanız onaylandı</p>" +
          "<p class=\"mentor-vitrin-publish-info-note\">Vitrin sayfanız onaylandı ve mentör ünvanınız aktif. " +
          "Ödeme hesabı ve görüşme bağlantınız tamamlandığında mentör listesinde görünür; " +
          "öğrenciler paketlerinizi satın alabilir.</p>";
      } else if (status === "rejected") {
        infoEl.hidden = false;
        infoEl.className = "mentor-vitrin-publish-info is-rejected";
        infoEl.innerHTML =
          "<p class=\"mentor-vitrin-publish-info-title\">Tekrar gönderim</p>" +
          "<ol class=\"mentor-vitrin-publish-info-steps\">" +
          "<li>Red gerekçesine göre vitrininizi güncelleyin.</li>" +
          "<li>Koşulları tekrar kabul edin.</li>" +
          "<li><strong>Vitrini incelemeye gönder</strong> butonuna tıklayın.</li>" +
          "</ol>" +
          "<p class=\"mentor-vitrin-publish-info-note\">Onaylandıktan sonra mentör ünvanınız aktif olur ve sayfanız yayınlanabilir.</p>";
      } else {
        infoEl.hidden = false;
        infoEl.className = "mentor-vitrin-publish-info is-draft";
        infoEl.innerHTML =
          "<p class=\"mentor-vitrin-publish-info-title\">Nasıl yayınlanır?</p>" +
          "<ol class=\"mentor-vitrin-publish-info-steps\">" +
          "<li>Vitrin bilgilerinizi (fotoğraf, hakkında, branş, paket vb.) doldurup kaydedin.</li>" +
          "<li>Aşağıdaki koşulları okuyup kabul edin.</li>" +
          "<li><strong>Vitrini incelemeye gönder</strong> butonuna tıklayın.</li>" +
          "</ol>" +
          "<p class=\"mentor-vitrin-publish-info-note\">Admin onayından sonra mentör ünvanınız aktif olur; " +
          "sayfanız mentör listesinde yayınlanabilir ve öğrenciler paketlerinizi satın alabilir.</p>";
      }
    }

    const canSubmit = status === "draft" || status === "rejected";
    if (consentsEl) consentsEl.hidden = !canSubmit;
    if (submitBtn) {
      submitBtn.hidden = !canSubmit;
      submitBtn.disabled = saving;
    }
  }

  function mentorVitrinConsentsAccepted() {
    return (
      document.getElementById("mentor-consent-kvkk")?.checked &&
      document.getElementById("mentor-consent-acik-riza")?.checked &&
      document.getElementById("mentor-consent-sozlesme")?.checked &&
      document.getElementById("mentor-consent-kosullar")?.checked
    );
  }

  async function submitVitrinForReview() {
    if (!currentUser || saving) return;
    if (!mentorVitrinConsentsAccepted()) {
      setMessage("Vitrin yayını için tüm koşulları kabul etmeniz gerekir.", true);
      return;
    }

    saving = true;
    renderVitrinReviewPanel();
    setMessage("İncelemeye gönderiliyor…");

    try {
      const { error } = await supabase.rpc("submit_mentor_vitrin_for_review", {
        p_accept_terms: true,
      });

      if (error) {
        const code = error.message || "";
        if (code.includes("vitrin_content_required")) {
          setMessage(
            "İncelemeye göndermek için en az fotoğraf, hakkında metni veya branş/özel ders ekleyin.",
            true,
          );
        } else if (code.includes("vitrin_review_not_submittable")) {
          setMessage("Sayfanız zaten incelemede veya yayında.", true);
        } else {
          setMessage("İncelemeye gönderilemedi. Lütfen tekrar deneyin.", true);
        }
        return;
      }

      pageData.vitrin_review_status = "pending";
      pageData.vitrin_review_note = null;
      renderVitrinReviewPanel();
      renderVitrinAvailability();
      setMessage("Sayfanız admin incelemesine gönderildi.");
    } finally {
      saving = false;
      renderVitrinReviewPanel();
    }
  }

  function initVitrinReviewPanel() {
    const submitBtn = document.getElementById("mentor-vitrin-submit-review");
    if (submitBtn && !submitBtn.dataset.bound) {
      submitBtn.dataset.bound = "1";
      submitBtn.addEventListener("click", () => {
        void submitVitrinForReview();
      });
    }
  }

  async function toggleVitrinAvailability() {
    if (!currentUser || saving) return;
    const nextActive = pageData.vitrin_active === false;
    const ok = await saveMentorPage(
      { vitrin_active: nextActive },
      { quiet: true, refreshEditors: true },
    );
    if (!ok) {
      setMessage("Vitrin durumu kaydedilemedi.", true);
      return;
    }
    renderVitrinAvailability();
  }

  async function renderVitrinDisplays() {
    const vitrin = window.RekabetliMentorVitrin;
    if (!vitrin) return;
    vitrin.renderVitrinBranches(
      branchesVitrinEl,
      pageData.branches,
      "Henüz branş eklemediniz.",
    );
    vitrin.renderVitrinLessons(
      lessonsVitrinEl,
      pageData.private_lessons,
      "Henüz özel ders eklemediniz.",
    );
    const fillCounts = currentUser?.id
      ? await vitrin.fetchPackageFillCounts(supabase, currentUser.id)
      : new Map();
    vitrin.renderVitrinPackages(
      packagesVitrinEl,
      pageData.packages,
      "Henüz paket eklemediniz.",
      {
        mentorId: currentUser?.id || null,
        mentorName: displayName,
        packageFillCounts: fillCounts,
        mentorAcceptsPayments: pageData.vitrin_active !== false,
      },
    );
    renderItemEditButtons("branch");
    renderItemEditButtons("lesson");
    renderPackageEditButtons();
  }

  function renderAll() {
    if (previewMode) return;
    if (displayNameEl) displayNameEl.textContent = displayName;
    renderVitrinReviewPanel();
    renderVitrinAvailability();
    renderVitrinAccent();
    renderPhoto();
    renderAbout();
    renderSummaries();
    void renderVitrinDisplays();
    renderItemEditors();
  }

  function collectItemsFromEditor(listEl, kind) {
    const vitrin = window.RekabetliMentorVitrin;
    if (!listEl) {
      return kind === "branch" ? [...pageData.branches] : [...pageData.private_lessons];
    }

    const items = [];
    listEl.querySelectorAll("[data-item-id]").forEach((card, index) => {
      const { title, description, accent } = readItemFromCard(card);
      if (!title && !description) return;
      items.push({
        id: card.dataset.itemId,
        title,
        description,
        accent: accent || vitrin?.getAccentForKind?.(kind, index) || null,
      });
    });
    return items;
  }

  function collectPackagesFromEditor() {
    const vitrin = window.RekabetliMentorVitrin;
    if (!packagesListEl) return [...pageData.packages];

    const items = [];
    packagesListEl.querySelectorAll("[data-item-id]").forEach((card, index) => {
      const { title, content, price, capacity, meeting_period, meeting_count, accent } =
        readPackageFromCard(card);
      if (!title && !content) return;
      items.push({
        id: card.dataset.itemId,
        title,
        content,
        price,
        capacity,
        meeting_period,
        meeting_count,
        accent: accent || vitrin?.getAccentForKind?.("package", index) || null,
      });
    });
    return items;
  }

  function collectPreviewSnapshot() {
    const vitrin = window.RekabetliMentorVitrin;
    const vitrinAccent =
      vitrin?.readAccentFromField?.(vitrinAccentPickerSlot) || pageData.vitrin_accent;

    return {
      photo_url: pageData.photo_url,
      vitrin_accent: vitrinAccent,
      about: pageData.about,
      branches: collectItemsFromEditor(branchesListEl, "branch"),
      private_lessons: collectItemsFromEditor(lessonsListEl, "lesson"),
      packages: collectPackagesFromEditor(),
    };
  }

  function renderPreviewPhoto(photoUrl) {
    const url = photoUrl;
    if (url) {
      setImage(photoImg, url, { alt: displayName });
      setFallbackVisible(photoFallback, false);
      return;
    }
    setImage(photoImg, null);
    if (photoFallback) {
      photoFallback.textContent = getInitials(displayName);
      setFallbackVisible(photoFallback, true);
    }
  }

  async function renderPreview(snapshot) {
    const vitrin = window.RekabetliMentorVitrin;
    if (!vitrin) return;

    if (displayNameEl) displayNameEl.textContent = displayName;
    vitrin.updateVitrinAvailabilityBadge?.(vitrinAvailabilityBadgeEl, pageData.vitrin_active);
    vitrin.applyVitrinShellAccent(showcaseEl, snapshot.vitrin_accent);
    renderPreviewPhoto(snapshot.photo_url);
    vitrin.fillAboutContent(aboutContentEl, snapshot.about);
    vitrin.fillSummaryList(summaryBranchesEl, snapshot.branches, "Branş bilgisi yok", "branch");
    vitrin.fillSummaryList(summaryLessonsEl, snapshot.private_lessons, "Ders bilgisi yok", "lesson");

    vitrin.renderVitrinBranches(
      document.getElementById("mentor-vitrin-branches"),
      snapshot.branches,
      "Henüz branş eklenmemiş.",
    );
    vitrin.renderVitrinLessons(
      document.getElementById("mentor-vitrin-lessons"),
      snapshot.private_lessons,
      "Henüz özel ders eklenmemiş.",
    );

    const fillCounts = currentUser?.id
      ? await vitrin.fetchPackageFillCounts(supabase, currentUser.id)
      : new Map();
    vitrin.renderVitrinPackages(
      document.getElementById("mentor-vitrin-packages"),
      snapshot.packages,
      "Henüz paket eklenmemiş.",
      {
        mentorId: currentUser?.id || null,
        mentorName: displayName,
        packageFillCounts: fillCounts,
        mentorAcceptsPayments: pageData.vitrin_active !== false,
      },
    );
  }

  function setPreviewMode(active) {
    previewMode = active;
    showcaseEl?.classList.toggle("mentor-showcase--preview", active);
    if (previewToggleBtn) {
      previewToggleBtn.textContent = active ? "Düzenlemeye dön" : "Ön izle";
    }
    if (toolbarLabelEl) toolbarLabelEl.hidden = !active;
    toolbarEl?.classList.toggle("is-preview", active);
  }

  function enterPreviewMode() {
    const snapshot = collectPreviewSnapshot();
    setPreviewMode(true);
    void renderPreview(snapshot);
    toolbarEl?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function exitPreviewMode() {
    if (!previewMode) return;
    setPreviewMode(false);
    renderAll();
  }

  previewToggleBtn?.addEventListener("click", () => {
    if (previewMode) exitPreviewMode();
    else enterPreviewMode();
  });

  vitrinAvailabilityToggleBtn?.addEventListener("click", () => {
    void toggleVitrinAvailability();
  });

  async function mountPackagePanelView(packageId) {
    const safeId = sanitizeItemId(packageId);
    const root = document.getElementById(`mentor-package-panel-root-${safeId}`);
    const pkg = pageData.packages.find((item) => sanitizeItemId(item.id) === safeId);
    if (!root || !pkg || !currentUser?.id || !window.RekabetliMentorMessaging?.mountPackagePanel) {
      return;
    }

    const countEl = document.getElementById(`mentor-package-student-count-${safeId}`);
    if (countEl) {
      const count = packageEnrolledCounts.get(safeId) || 0;
      countEl.textContent = `${count} danışan / öğrenci`;
    }

    const deepLink = window.RekabetliMentorMessaging.parseInboxDeepLink?.() || null;
    await window.RekabetliMentorMessaging.mountPackagePanel({
      root,
      mentorId: currentUser.id,
      packageId: safeId,
      packageTitle: pkg.title,
      deepLink,
      onPackageChanged: async () => {
        await refreshPackageNavCounts();
        await loadLinkedStudents();
      },
      onOpenStudent: (student) => {
        openPackageStudentView({
          packageId: safeId,
          studentId: student.id,
          displayName: student.display_name,
        });
      },
    });
  }

  async function mountMentorInbox() {
    const root = document.getElementById("mentor-inbox-root");
    if (!root || !currentUser?.id || !window.RekabetliMentorMessaging?.mountMentorInbox) return;
    const deepLink = window.RekabetliMentorMessaging.parseInboxDeepLink?.() || null;
    await window.RekabetliMentorMessaging.mountMentorInbox({
      root,
      mentorId: currentUser.id,
      deepLink,
    });
    void renderMentorUpcomingMeetings();
    void renderMentorAllMeetingsCalendar();
  }

  function openMentorMeeting(meeting) {
    if (!meeting) return;
    openPackageStudentView({
      packageId: meeting.package_id,
      studentId: meeting.student_id,
      displayName: meeting.studentName,
    });
  }

  async function renderMentorUpcomingMeetings() {
    const host = document.getElementById("mentor-upcoming-meetings-host");
    if (!host || !currentUser?.id) return;

    if (!window.RekabetliMentorMeetingProposals?.mountUpcomingMeetingsBox) {
      host.hidden = true;
      return;
    }

    await window.RekabetliMentorMeetingProposals.mountUpcomingMeetingsBox(host, {
      mentorId: currentUser.id,
      perspective: "mentor",
      onOpenMeeting: openMentorMeeting,
    });
  }

  async function renderMentorAllMeetingsCalendar() {
    const host = document.getElementById("mentor-all-meetings-calendar-host");
    if (!host || !currentUser?.id) return;

    if (!window.RekabetliMentorMeetingProposals?.mountAllMeetingsCalendar) {
      host.hidden = true;
      return;
    }

    await window.RekabetliMentorMeetingProposals.mountAllMeetingsCalendar(host, {
      mentorId: currentUser.id,
      perspective: "mentor",
      onOpenMeeting: openMentorMeeting,
    });
  }

  const INVITE_ERROR_MESSAGES = {
    auth_required: "Giriş yapmalısınız.",
    mentor_required: "Yalnızca mentörler öğrenci ekleyebilir.",
    invalid_code: "Geçerli bir öğrenci kodu girin.",
    student_not_found: "Bu koda sahip bir kullanıcı bulunamadı.",
    cannot_link_self: "Kendi kodunuzu kullanarak kendinizi ekleyemezsiniz.",
    student_not_linked: "Öğrenci bulunamadı veya panele ekli değil.",
    invalid_package: "Geçerli bir paket seçin.",
    package_not_found: "Paket bulunamadı.",
    not_enrolled: "Öğrenci bu pakete kayıtlı değil.",
  };

  function getMentorPackageOptions() {
    return pageData.packages
      .filter((pkg) => pkg.title?.trim())
      .map((pkg) => ({
        id: sanitizeItemId(pkg.id),
        title: pkg.title.trim(),
      }));
  }

  function getPackageTitle(packageId) {
    const pkg = pageData.packages.find((item) => sanitizeItemId(item.id) === packageId);
    return pkg?.title?.trim() || "Paket";
  }

  async function loadStudentEnrollmentsByStudentId() {
    if (!currentUser?.id) return new Map();

    const { data, error } = await supabase
      .from("mentor_package_students")
      .select("student_id, package_id")
      .eq("mentor_id", currentUser.id);

    if (error) {
      console.warn("mentor package students:", error.message);
      return new Map();
    }

    const map = new Map();
    (data || []).forEach((row) => {
      const list = map.get(row.student_id) || [];
      list.push(String(row.package_id));
      map.set(row.student_id, list);
    });
    return map;
  }

  async function refreshPackageNavCounts() {
    const [fillCounts, enrolledCounts] = await Promise.all([
      loadPackageFillCounts(),
      loadPackageEnrolledCounts(),
    ]);
    packageFillCounts = fillCounts;
    packageEnrolledCounts = enrolledCounts;
    await renderPackageNavAndPanels();
  }

  function mapInviteError(error) {
    const msg = error?.message || "";
    for (const [key, label] of Object.entries(INVITE_ERROR_MESSAGES)) {
      if (msg.includes(key)) return label;
    }
    return `İşlem tamamlanamadı: ${msg}`;
  }

  function createPackageSelect(packages, studentId) {
    const select = document.createElement("select");
    select.className = "mentor-linked-student-package-select";
    select.setAttribute("aria-label", "Paket seçin");

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = packages.length ? "Paket seçin" : "Önce paket oluşturun";
    select.appendChild(placeholder);

    packages.forEach((pkg) => {
      const option = document.createElement("option");
      option.value = pkg.id;
      option.textContent = pkg.title;
      select.appendChild(option);
    });

    select.disabled = !packages.length;
    select.dataset.studentId = studentId;
    return select;
  }

  function createPackageChip(packageId) {
    const chip = document.createElement("span");
    chip.className = "mentor-linked-students-package-chip";
    chip.textContent = getPackageTitle(packageId);
    chip.title = getPackageTitle(packageId);
    return chip;
  }

  async function enrollStudentInPackage(studentId, packageId) {
    if (!packageId) {
      setInviteMessage("Önce bir paket seçin.", true);
      return;
    }

    try {
      const { data, error } = await supabase.rpc("enroll_linked_student_in_package", {
        p_student_id: studentId,
        p_package_id: packageId,
      });
      if (error) throw error;

      const title = data?.package_title || getPackageTitle(packageId);
      setInviteMessage(
        data?.already_enrolled ? `${title} paketine zaten ekli.` : `${title} paketine eklendi.`,
        false,
      );
      await loadLinkedStudents();
      await refreshPackageNavCounts();
    } catch (enrollError) {
      console.error("enroll student:", enrollError);
      setInviteMessage(mapInviteError(enrollError), true);
    }
  }

  async function removeLinkedStudent(studentId, displayName) {
    const name = displayName || "Öğrenci";
    const confirmed = await window.rekabetliConfirm?.({
      title: "Öğrenciyi kaldır",
      message: `${name} panelden kaldırılsın mı? Paket atamaları da silinir.`,
      confirmLabel: "Kaldır",
      danger: true,
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase.rpc("unlink_mentor_student", {
        p_student_id: studentId,
      });
      if (error) throw error;

      setInviteMessage(`${name} panelden kaldırıldı.`, false);
      await loadLinkedStudents();
      await refreshPackageNavCounts();
    } catch (unlinkError) {
      console.error("unlink student:", unlinkError);
      setInviteMessage(mapInviteError(unlinkError), true);
    }
  }

  function normalizeInviteCode(raw) {
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function setInviteMessage(text, isError = false) {
    const el = document.getElementById("mentor-invite-message");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("profile-message-error", Boolean(isError));
    el.classList.toggle("empty", !text);
  }

  function buildReferralLink(codeOrPath) {
    const raw = String(codeOrPath || "").trim();
    if (!raw) return "";
    if (raw.startsWith("/r/")) {
      return `${window.location.origin.replace(/\/$/, "")}${raw}`;
    }
    const normalized = raw.toUpperCase().replace(/\s+/g, "");
    return `${window.location.origin.replace(/\/$/, "")}/r/${encodeURIComponent(normalized)}`;
  }

  async function loadMentorReferralProgram() {
    const linkInput = document.getElementById("mentor-referral-link");
    const copyBtn = document.getElementById("mentor-referral-copy");
    const statsEl = document.getElementById("mentor-referral-stats");
    const signupsEl = document.getElementById("mentor-referral-signups");
    const clicksEl = document.getElementById("mentor-referral-clicks");
    const messageEl = document.getElementById("mentor-referral-message");
    if (!linkInput || !currentUser?.id) return;

    const { data, error } = await supabase.rpc("get_my_referral_program");
    if (error) {
      console.error("get_my_referral_program:", error.message);
      if (messageEl) {
        messageEl.textContent = "Davet linki yüklenemedi.";
        messageEl.classList.add("profile-message-error");
        messageEl.classList.remove("empty");
      }
      return;
    }

    const fullLink = buildReferralLink(data?.code || data?.link_path);
    linkInput.value = fullLink;

    if (!fullLink && messageEl) {
      messageEl.textContent = "Davet kodu oluşturulamadı. Sayfayı yenileyin.";
      messageEl.classList.add("profile-message-error");
      messageEl.classList.remove("empty");
    }

    if (signupsEl) signupsEl.textContent = `${Number(data?.signup_count) || 0} kayıt`;
    if (clicksEl) clicksEl.textContent = `${Number(data?.click_count) || 0} tıklama`;
    if (statsEl) statsEl.hidden = false;

    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = "1";
      copyBtn.addEventListener("click", async () => {
        if (!linkInput.value) return;
        try {
          await navigator.clipboard.writeText(linkInput.value);
          if (messageEl) {
            messageEl.textContent = "Link kopyalandı.";
            messageEl.classList.remove("profile-message-error", "empty");
          }
        } catch {
          linkInput.select();
          document.execCommand("copy");
        }
      });
    }
  }

  async function loadLinkedStudents() {
    const listHost = document.getElementById("mentor-linked-students-list-host");
    const emptyEl = document.getElementById("mentor-linked-students-empty");
    const titleEl = document.querySelector(".mentor-linked-students-title");
    if (!listHost || !emptyEl || !currentUser?.id) return;

    const [{ data: links, error }, enrollmentsByStudent] = await Promise.all([
      supabase
        .from("mentor_linked_students")
        .select("id, linked_at, student_id")
        .eq("mentor_id", currentUser.id)
        .eq("linked_source", "code")
        .order("linked_at", { ascending: false }),
      loadStudentEnrollmentsByStudentId(),
    ]);

    if (error) {
      console.error("mentor linked students:", error.message);
      listHost.hidden = true;
      listHost.replaceChildren();
      if (titleEl) titleEl.hidden = false;
      emptyEl.hidden = false;
      emptyEl.textContent = error.message.includes("mentor_linked_students")
        ? "Öğrenci listesi için veritabanı kurulumu gerekli."
        : "Öğrenci listesi yüklenemedi.";
      return;
    }

    const rows = links || [];
    if (!rows.length) {
      listHost.hidden = true;
      listHost.replaceChildren();
      if (titleEl) titleEl.hidden = false;
      emptyEl.hidden = false;
      emptyEl.textContent = "Henüz öğrenci eklenmedi.";
      return;
    }

    const studentIds = rows.map((row) => row.student_id);
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", studentIds);

    if (profileError) {
      console.error("mentor linked student profiles:", profileError.message);
      setInviteMessage("Öğrenci profilleri yüklenemedi.", true);
      return;
    }

    const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    const packageOptions = getMentorPackageOptions();

    const listEl = document.createElement("ul");
    listEl.id = "mentor-linked-students-list";
    listEl.className = "mentor-linked-students-list";

    emptyEl.hidden = true;
    listHost.hidden = false;
    listHost.replaceChildren();

    rows.forEach((row) => {
      const student = profileById.get(row.student_id);
      const displayName = student?.display_name?.trim() || "Öğrenci";
      const enrolledPackages = enrollmentsByStudent.get(row.student_id) || [];

      const item = document.createElement("li");
      item.className = "mentor-linked-students-item";

      const main = document.createElement("div");
      main.className = "mentor-linked-students-main";

      const name = document.createElement("p");
      name.className = "mentor-linked-students-name";
      name.textContent = displayName;

      const packagesWrap = document.createElement("div");
      packagesWrap.className = "mentor-linked-students-packages";
      if (enrolledPackages.length) {
        enrolledPackages.forEach((packageId) => {
          packagesWrap.appendChild(createPackageChip(packageId));
        });
      } else {
        const emptyPackages = document.createElement("span");
        emptyPackages.className = "mentor-linked-students-packages-empty";
        emptyPackages.textContent = "Henüz pakete eklenmedi";
        packagesWrap.appendChild(emptyPackages);
      }

      main.append(name, packagesWrap);

      const actions = document.createElement("div");
      actions.className = "mentor-linked-students-actions";

      const packageSelect = createPackageSelect(packageOptions, row.student_id);

      const enrollBtn = document.createElement("button");
      enrollBtn.type = "button";
      enrollBtn.className = "secondary mentor-linked-students-enroll-btn";
      enrollBtn.textContent = "Pakete ekle";
      enrollBtn.disabled = !packageOptions.length;
      enrollBtn.addEventListener("click", () => {
        void enrollStudentInPackage(row.student_id, packageSelect.value);
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "secondary mentor-linked-students-remove-btn";
      removeBtn.textContent = "Kaldır";
      removeBtn.addEventListener("click", () => {
        void removeLinkedStudent(row.student_id, displayName);
      });

      actions.append(packageSelect, enrollBtn, removeBtn);
      item.append(main, actions);
      listEl.appendChild(item);
    });

    const mountAccordion = window.RekabetliMentorMessaging?.mountStudentListAccordion;
    const useAccordion = window.RekabetliMentorMessaging?.shouldUseStudentListAccordion?.(rows.length);

    if (useAccordion && mountAccordion) {
      if (titleEl) titleEl.hidden = true;
      mountAccordion({
        panel: listHost,
        listEl,
        count: rows.length,
        title: "Eklenen öğrenciler",
      });
    } else {
      if (titleEl) titleEl.hidden = false;
      listHost.appendChild(listEl);
    }
  }

  async function submitInviteStudentCode(rawCode) {
    const code = normalizeInviteCode(rawCode);
    if (code.length < 6) {
      setInviteMessage("Geçerli bir öğrenci kodu girin.", true);
      return;
    }

    const submitBtn = document.getElementById("mentor-invite-submit");
    if (submitBtn) submitBtn.disabled = true;

    try {
      const { data, error } = await supabase.rpc("link_student_by_user_code", { p_code: code });
      if (error) throw error;

      const name = data?.display_name || "Öğrenci";
      setInviteMessage(
        data?.already_linked ? `${name} zaten ekli.` : `${name} panele eklendi.`,
        false,
      );

      const input = document.getElementById("mentor-invite-code");
      if (input) input.value = "";
      await loadLinkedStudents();
      await refreshPackageNavCounts();
    } catch (inviteError) {
      console.error("invite student:", inviteError);
      setInviteMessage(mapInviteError(inviteError), true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function initMentorStudentInvite() {
    const form = document.getElementById("mentor-invite-student-form");
    const codeInput = document.getElementById("mentor-invite-code");
    if (!form || !codeInput) return;

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitInviteStudentCode(codeInput.value);
    });

    codeInput.addEventListener("input", () => {
      const normalized = normalizeInviteCode(codeInput.value);
      if (codeInput.value !== normalized) codeInput.value = normalized;
    });
  }

  function setMeetingLinkMessage(text, isError = false) {
    const el = document.getElementById("mentor-meeting-link-message");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("empty", !text);
    el.classList.toggle("profile-message-error", Boolean(text && isError));
  }

  function getSelectedMeetingPlatform() {
    const checked = document.querySelector('input[name="mentorMeetingPlatform"]:checked');
    const vitrin = window.RekabetliMentorVitrin;
    return vitrin?.sanitizeMeetingPlatform?.(checked?.value) || "google_meet";
  }

  function updateMeetingLinkPlaceholder() {
    const input = document.getElementById("mentor-meeting-link-input");
    const hint = document.getElementById("mentor-meeting-link-hint");
    const platform = getSelectedMeetingPlatform();
    if (input) {
      input.placeholder =
        platform === "zoom"
          ? "https://zoom.us/j/1234567890"
          : "https://meet.google.com/xxx-xxxx-xxx";
    }
    if (hint) {
      hint.textContent =
        platform === "zoom"
          ? "Zoom HTTPS katılım bağlantısı girin (zoom.us veya …zoom.us)."
          : "Google Meet HTTPS bağlantısı girin (meet.google.com).";
    }
  }

  function getMeetingLinkFormState() {
    const platform = getSelectedMeetingPlatform();
    const rawLink = document.getElementById("mentor-meeting-link-input")?.value?.trim() || "";
    const vitrin = window.RekabetliMentorVitrin;
    const safeLink = rawLink ? vitrin?.sanitizeMeetingLink?.(platform, rawLink) : null;
    return { platform, rawLink, safeLink };
  }

  function isMeetingLinkSaved() {
    const vitrin = window.RekabetliMentorVitrin;
    return Boolean(
      vitrin?.hasConsultationMeetingLink?.({
        meetingPlatform: pageData.meeting_platform,
        meetingLink: pageData.meeting_link,
      }),
    );
  }

  function isMeetingLinkFormDirty() {
    const savedPlatform = pageData.meeting_platform || "google_meet";
    const savedLink = pageData.meeting_link || "";
    const current = getMeetingLinkFormState();

    if (!savedLink) {
      return Boolean(current.rawLink) || current.platform !== savedPlatform;
    }

    return current.platform !== savedPlatform || current.safeLink !== savedLink;
  }

  function updateMeetingLinkSaveState() {
    const saveBtn = document.getElementById("mentor-meeting-link-save");
    const passiveNote = document.getElementById("mentor-meeting-link-passive-note");
    const isReady = isMeetingLinkSaved();

    if (passiveNote) {
      passiveNote.hidden = isReady;
    }

    if (saveBtn) {
      const current = getMeetingLinkFormState();
      saveBtn.disabled = !(isMeetingLinkFormDirty() && current.safeLink);
    }
  }

  function renderMeetingLinkStatus() {
    const statusEl = document.getElementById("mentor-meeting-link-status");
    if (!statusEl) return;

    const vitrin = window.RekabetliMentorVitrin;
    const isReady = vitrin?.hasConsultationMeetingLink?.({
      meetingPlatform: pageData.meeting_platform,
      meetingLink: pageData.meeting_link,
    });

    statusEl.className = `mentor-meeting-link-status${
      isReady ? " mentor-meeting-link-status--ok" : " mentor-meeting-link-status--warn"
    }`;
    statusEl.textContent = isReady ? "✓" : "⚠";
    statusEl.setAttribute(
      "aria-label",
      isReady ? "Görüşme bağlantısı kayıtlı" : "Görüşme bağlantısı gerekli",
    );
    statusEl.title = isReady ? "Görüşme bağlantısı kayıtlı" : "Görüşme bağlantısı gerekli";
  }

  function renderMeetingLinkForm() {
    const form = document.getElementById("mentor-meeting-link-form");
    const input = document.getElementById("mentor-meeting-link-input");
    if (!form || !input) return;

    const platform = pageData.meeting_platform || "google_meet";
    const platformInput = form.querySelector(`input[value="${platform}"]`);
    if (platformInput) platformInput.checked = true;
    input.value = pageData.meeting_link || "";
    updateMeetingLinkPlaceholder();
    renderMeetingLinkStatus();
    updateMeetingLinkSaveState();
  }

  function initMentorMeetingLink() {
    const form = document.getElementById("mentor-meeting-link-form");
    const saveBtn = document.getElementById("mentor-meeting-link-save");
    const linkInput = document.getElementById("mentor-meeting-link-input");
    if (!form) return;

    form.querySelectorAll('input[name="mentorMeetingPlatform"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        updateMeetingLinkPlaceholder();
        updateMeetingLinkSaveState();
      });
    });

    linkInput?.addEventListener("input", updateMeetingLinkSaveState);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saveBtn?.disabled) return;
      const vitrin = window.RekabetliMentorVitrin;
      const platform = getSelectedMeetingPlatform();
      const rawLink = document.getElementById("mentor-meeting-link-input")?.value?.trim() || "";

      if (!rawLink) {
        setMeetingLinkMessage("Görüşme bağlantısı girin.", true);
        return;
      }

      const safeLink = vitrin?.sanitizeMeetingLink?.(platform, rawLink);
      if (!safeLink) {
        setMeetingLinkMessage(
          platform === "zoom"
            ? "Geçerli bir Zoom bağlantısı girin (https://zoom.us/j/…)."
            : "Geçerli bir Google Meet bağlantısı girin (https://meet.google.com/…).",
          true,
        );
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      setMeetingLinkMessage("Kaydediliyor…");

      const ok = await saveMentorPage(
        { meeting_platform: platform, meeting_link: safeLink },
        { quiet: true, refreshEditors: false },
      );

      if (!ok) {
        if (saveBtn) saveBtn.disabled = false;
        updateMeetingLinkSaveState();
        setMeetingLinkMessage("Bağlantı kaydedilemedi.", true);
        return;
      }

      renderMeetingLinkForm();
      setMeetingLinkMessage(getMentorActivationMessage());
    });
  }

  function setPayoutMessage(text, isError = false) {
    const el = document.getElementById("mentor-payout-message");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("empty", !text);
    el.classList.toggle("profile-message-error", Boolean(text && isError));
  }

  function normalizeIbanInput(value) {
    const banks = window.RekabetliTurkishBanks;
    if (banks?.formatTurkishIbanInput) {
      return banks.formatTurkishIbanInput(value);
    }
    const vitrin = window.RekabetliMentorVitrin;
    return vitrin?.formatIbanDraftDisplay?.(value) || String(value || "").trim();
  }

  function resolvePayoutBankNameFromIban(ibanRaw) {
    const banks = window.RekabetliTurkishBanks;
    const vitrin = window.RekabetliMentorVitrin;
    const compact = banks?.compactTurkishIban?.(ibanRaw) || "";
    const detected = banks?.resolveTurkishBankName?.(ibanRaw);
    if (detected) return vitrin?.sanitizePayoutBankName?.(detected) || detected;

    if (
      compact &&
      compact === pageData.payout_iban &&
      pageData.payout_bank_name
    ) {
      return pageData.payout_bank_name;
    }

    return null;
  }

  function renderPayoutBankDisplay() {
    const bankEl = document.getElementById("mentor-payout-bank-display");
    const ibanInput = document.getElementById("mentor-payout-iban");
    if (!bankEl) return;

    const raw = ibanInput?.value || pageData.payout_iban || "";
    const banks = window.RekabetliTurkishBanks;
    const bankName = resolvePayoutBankNameFromIban(raw);
    const code = banks?.extractTurkishBankCode?.(raw);
    const isKnown = Boolean(
      bankName &&
        code &&
        banks?.BANK_CODES &&
        Object.prototype.hasOwnProperty.call(banks.BANK_CODES, code),
    );
    const isUnknownCode = Boolean(code && !isKnown && banks?.compactTurkishIban?.(raw)?.length >= 9);

    if (bankName) {
      bankEl.textContent = bankName;
      bankEl.classList.remove("is-empty", "is-unknown");
      if (isUnknownCode) bankEl.classList.add("is-unknown");
      return;
    }

    if (isUnknownCode) {
      const label = banks?.resolveTurkishBankLabel?.(raw);
      bankEl.textContent = label || "Banka algılanamadı";
      bankEl.classList.remove("is-empty");
      bankEl.classList.add("is-unknown");
      return;
    }

    bankEl.textContent = "IBAN girildiğinde otomatik belirlenir.";
    bankEl.classList.add("is-empty");
    bankEl.classList.remove("is-unknown");
  }

  function getMentorActivationMessage() {
    const vitrin = window.RekabetliMentorVitrin;
    const reviewStatus = vitrin?.normalizeVitrinReviewStatus?.(pageData.vitrin_review_status) || "draft";
    if (reviewStatus === "pending") {
      return "Kaydedildi. Vitrin sayfanız admin incelemesinde.";
    }
    if (reviewStatus === "draft" || reviewStatus === "rejected") {
      return "Kaydedildi. Vitrinde yayınlanması için koşulları kabul edip incelemeye gönderin.";
    }
    const meetingReady = vitrin?.hasConsultationMeetingLink?.({
      meetingPlatform: pageData.meeting_platform,
      meetingLink: pageData.meeting_link,
    });
    const payoutReady = vitrin?.hasPayoutBankDetails?.({
      payoutReady: pageData.payout_ready,
      accountHolder: pageData.payout_account_holder,
      bankName: pageData.payout_bank_name,
      iban: pageData.payout_iban,
    });
    if (meetingReady && payoutReady) {
      return "Profiliniz vitrin koşullarını karşılıyor.";
    }
    const missing = [];
    if (!meetingReady) missing.push("görüşme bağlantısı (Danışman/Öğrenciler)");
    if (!payoutReady) missing.push("hesap bilgileri (Cüzdanım)");
    return `Kaydedildi. Vitrin listesi için eksik: ${missing.join(", ")}.`;
  }

  function isPayoutReady() {
    const vitrin = window.RekabetliMentorVitrin;
    return Boolean(
      vitrin?.hasPayoutBankDetails?.({
        payoutReady: pageData.payout_ready,
        accountHolder: pageData.payout_account_holder,
        bankName: pageData.payout_bank_name,
        iban: pageData.payout_iban,
      }),
    );
  }

  function applyWalletSideLayout() {
    const sideEl = document.getElementById("mentor-wallet-layout-side");
    if (!sideEl) return;
    sideEl.classList.toggle("is-payout-ready", isPayoutReady());
  }

  function setPayoutAccordionOpen(isOpen, { userAction = false } = {}) {
    const section = document.getElementById("mentor-payout-accordion");
    const trigger = document.getElementById("mentor-payout-trigger");
    const panel = document.getElementById("mentor-payout-panel-body");
    const editHint = document.getElementById("mentor-payout-edit-hint");
    if (!section || !panel) return;

    if (userAction) payoutAccordionPinnedOpen = isOpen;

    section.classList.toggle("is-open", isOpen);
    panel.hidden = !isOpen;
    trigger?.setAttribute("aria-expanded", isOpen ? "true" : "false");

    if (editHint) {
      editHint.hidden = isOpen || !isPayoutReady();
    }
  }

  function applyPayoutAccordionState({ afterSave = false } = {}) {
    if (afterSave && isPayoutReady()) {
      payoutAccordionPinnedOpen = false;
      setPayoutAccordionOpen(false);
      return;
    }
    if (payoutAccordionPinnedOpen) {
      setPayoutAccordionOpen(true);
      return;
    }
    setPayoutAccordionOpen(!isPayoutReady());
  }

  function renderPayoutSummary() {
    const summaryEl = document.getElementById("mentor-payout-summary");
    if (!summaryEl) return;

    if (!isPayoutReady()) {
      summaryEl.textContent = "";
      summaryEl.hidden = true;
      return;
    }

    const bank = pageData.payout_bank_name || "";
    const iban = pageData.payout_iban || "";
    const last4 = iban.slice(-4);
    const text = bank && last4 ? `${bank} · ···${last4}` : bank || "";
    summaryEl.textContent = text;
    summaryEl.hidden = !text;
    const editHint = document.getElementById("mentor-payout-edit-hint");
    const section = document.getElementById("mentor-payout-accordion");
    if (editHint && section) {
      editHint.hidden = section.classList.contains("is-open") || !isPayoutReady();
    }
  }

  function renderPayoutStatus() {
    const statusEl = document.getElementById("mentor-payout-status");
    if (!statusEl) return;

    const isReady = isPayoutReady();

    statusEl.className = `mentor-payout-status${
      isReady ? " mentor-payout-status--ok" : " mentor-payout-status--warn"
    }`;
    statusEl.textContent = isReady ? "✓" : "⚠";
    statusEl.setAttribute(
      "aria-label",
      isReady ? "Hesap bilgileri kayıtlı" : "Hesap bilgileri gerekli",
    );
    statusEl.title = isReady ? "Hesap bilgileri kayıtlı" : "Hesap bilgileri gerekli";
    renderPayoutSummary();
    applyWalletSideLayout();
  }

  function renderPayoutForm() {
    const holderInput = document.getElementById("mentor-payout-account-holder");
    const ibanInput = document.getElementById("mentor-payout-iban");
    if (!holderInput || !ibanInput) return;

    const vitrin = window.RekabetliMentorVitrin;
    holderInput.value = pageData.payout_account_holder || "";
    ibanInput.value = vitrin?.formatTurkishIbanDisplay?.(pageData.payout_iban) || "";
    renderPayoutStatus();
    renderPayoutBankDisplay();
    applyPayoutAccordionState();
  }

  async function loadMentorPayoutAccount(userId) {
    const vitrin = window.RekabetliMentorVitrin;
    const { data, error } = await supabase
      .from("mentor_payout_accounts")
      .select("account_holder, bank_name, iban")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      if (error.message?.includes("mentor_payout_accounts")) {
        console.warn("mentor_payout_accounts tablosu yok; supabase-mentor-payout-account.sql çalıştırın.");
        return;
      }
      throw error;
    }

    pageData.payout_account_holder =
      vitrin?.sanitizePayoutAccountHolder?.(data?.account_holder) || null;
    pageData.payout_bank_name = vitrin?.sanitizePayoutBankName?.(data?.bank_name) || null;
    pageData.payout_iban = vitrin?.sanitizeTurkishIban?.(data?.iban) || null;
  }

  async function saveMentorPayoutAccount({ account_holder, bank_name, iban }) {
    if (!currentUser || saving) return false;
    saving = true;

    try {
      const { error } = await supabase.from("mentor_payout_accounts").upsert(
        {
          user_id: currentUser.id,
          account_holder,
          bank_name,
          iban,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      if (error) {
        if (error.message?.includes("mentor_payout_accounts")) {
          throw new Error(
            "mentor_payout_accounts tablosu bulunamadı. supabase-mentor-payout-account.sql dosyasını çalıştırın.",
          );
        }
        throw error;
      }

      pageData.payout_account_holder = account_holder;
      pageData.payout_bank_name = bank_name;
      pageData.payout_iban = iban;
      pageData.payout_ready = true;
      return true;
    } catch (error) {
      console.error("mentor payout save:", error);
      throw error;
    } finally {
      saving = false;
    }
  }

  function initMentorPayoutAccount() {
    const form = document.getElementById("mentor-payout-form");
    const saveBtn = document.getElementById("mentor-payout-save");
    const ibanInput = document.getElementById("mentor-payout-iban");
    const trigger = document.getElementById("mentor-payout-trigger");
    if (!form) return;

    trigger?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const section = document.getElementById("mentor-payout-accordion");
      const willOpen = !section?.classList.contains("is-open");
      setPayoutAccordionOpen(willOpen, { userAction: true });
    });

    ibanInput?.addEventListener("input", () => {
      if (!ibanInput) return;
      const normalized = normalizeIbanInput(ibanInput.value);
      if (ibanInput.value !== normalized) ibanInput.value = normalized;
      renderPayoutBankDisplay();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const vitrin = window.RekabetliMentorVitrin;
      const holderRaw = document.getElementById("mentor-payout-account-holder")?.value?.trim() || "";
      const ibanRaw = document.getElementById("mentor-payout-iban")?.value?.trim() || "";

      const account_holder = vitrin?.sanitizePayoutAccountHolder?.(holderRaw);
      const iban = vitrin?.sanitizeTurkishIban?.(ibanRaw);
      const bank_name = resolvePayoutBankNameFromIban(ibanRaw);

      if (!account_holder) {
        setPayoutMessage("Geçerli bir hesap sahibi adı girin (en az 3 karakter).", true);
        return;
      }
      if (!iban) {
        setPayoutMessage("Geçerli bir Türkiye IBAN numarası girin (TR + 24 rakam).", true);
        return;
      }
      if (!bank_name) {
        setPayoutMessage("IBAN'dan banka algılanamadı. Listede yer alan bir bankanın IBAN'ını girin.", true);
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      setPayoutMessage("Kaydediliyor…");

      try {
        const ok = await saveMentorPayoutAccount({ account_holder, bank_name, iban });
        if (!ok) {
          setPayoutMessage("Hesap bilgileri kaydedilemedi.", true);
          return;
        }
        renderPayoutForm();
        setPayoutMessage(getMentorActivationMessage());
        applyPayoutAccordionState({ afterSave: true });
        void loadMentorWallet();
      } catch (error) {
        setPayoutMessage(error.message || "Hesap bilgileri kaydedilemedi.", true);
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  function formatTryMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "0 ₺";
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function parseTryAmountInput(value) {
    if (value == null || value === "") return null;
    const normalized = String(value).trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) return null;
    return Math.round(amount * 100) / 100;
  }

  function getMentorPayoutMinAmount() {
    const min = Number(lastWalletSummary?.payout_min_amount);
    return Number.isFinite(min) && min > 0 ? min : 500;
  }

  function getMentorPayoutRequestAmount() {
    return parseTryAmountInput(document.getElementById("mentor-wallet-payout-amount")?.value);
  }

  async function readSupabaseFunctionResult(result) {
    const { data, error } = result || {};
    if (!error) {
      return {
        data,
        errorCode: data?.error ? String(data.error) : null,
        errorMessage: data?.message ? String(data.message) : null,
      };
    }

    let payload = data;
    if (!payload && error?.context && typeof error.context.json === "function") {
      try {
        payload = await error.context.json();
      } catch {
        payload = null;
      }
    }

    return {
      data: payload,
      errorCode: payload?.error ? String(payload.error) : null,
      errorMessage: payload?.message
        ? String(payload.message)
        : error?.message
          ? String(error.message)
          : null,
    };
  }

  function formatPayoutFunctionError(errorCode, errorMessage) {
    const code = String(errorCode || "");
    const message = String(errorMessage || "");
    if (code.includes("wise_api_failed") || message.includes("invalid_token")) {
      return "Wise API anahtarı geçersiz veya süresi dolmuş. Yönetici WISE_API_TOKEN değerini güncellemeli.";
    }
    if (code.includes("payout_amount_below_minimum")) {
      return `Minimum ödeme tutarı ${formatTryMoney(getMentorPayoutMinAmount())}.`;
    }
    if (code.includes("payout_amount_too_low_after_fee")) {
      return "Transfer ücreti sonrası ödenecek tutar kalmıyor.";
    }
    if (code.includes("payout_insufficient_balance")) {
      return "Yeterli bakiye yok.";
    }
    if (code.includes("payout_amount_invalid")) {
      return "Geçerli bir tutar girin.";
    }
    if (message) return message;
    return "Transfer ücreti hesaplanamadı.";
  }

  function updateMentorPayoutAmountFieldLimits() {
    const input = document.getElementById("mentor-wallet-payout-amount");
    const hint = document.getElementById("mentor-wallet-payout-amount-hint");
    if (!input) return;

    const available = Number(lastWalletSummary?.available_balance) || 0;
    const minAmount = getMentorPayoutMinAmount();
    input.min = String(minAmount);
    input.max = available > 0 ? String(available) : String(minAmount);

    if (hint) {
      hint.textContent = available > 0
        ? `Minimum ${formatTryMoney(minAmount)}, en fazla ${formatTryMoney(available)}. Talep tutarından Wise banka transfer ücreti düşülür.`
        : `Minimum ${formatTryMoney(minAmount)}. Talep tutarından Wise banka transfer ücreti düşülür.`;
    }
  }

  const MENTOR_PAYOUT_FEE_NOTE = "Talep tutarından Wise banka transfer ücreti düşülür.";

  function renderMentorReferralCommissionStats(stats) {
    const statsEl = document.getElementById("mentor-wallet-referral-stats");
    const loadingEl = document.getElementById("mentor-wallet-referral-loading");
    if (!statsEl) return;

    if (loadingEl) loadingEl.hidden = true;
    statsEl.hidden = false;
    statsEl.replaceChildren();

    const ratePct = Number(stats?.commission_rate_pct) || 5;
    const items = [
      {
        label: "Linkten kayıt",
        value: String(Number(stats?.signup_count) || 0),
        note: "Davet linkinizle üye olan",
      },
      {
        label: "Kendi paketinizden alım",
        value: String(Number(stats?.own_package_buyer_count) || 0),
        note: "Davetlilerinizden alıcı",
      },
      {
        label: "Başka mentörden alım",
        value: String(Number(stats?.other_mentor_buyer_count) || 0),
        note: "Affiliate komisyonu",
      },
      {
        label: "Toplam kazanç",
        value: formatTryMoney(stats?.total_earnings),
        note: `Kendi satış indirimi + affiliate (%${ratePct}); iadeler düşülmüştür`,
        wide: true,
      },
    ];

    items.forEach((item) => {
      const chip = document.createElement("div");
      chip.className = `mentor-wallet-referral-stat${item.wide ? " mentor-wallet-referral-stat--wide" : ""}`;

      const label = document.createElement("span");
      label.className = "mentor-wallet-referral-stat-label";
      label.textContent = item.label;

      const value = document.createElement("strong");
      value.className = "mentor-wallet-referral-stat-value";
      value.textContent = item.value;

      chip.append(label, value);

      if (item.note) {
        const note = document.createElement("span");
        note.className = "mentor-wallet-referral-stat-note";
        note.textContent = item.note;
        chip.appendChild(note);
      }

      statsEl.appendChild(chip);
    });
  }

  async function loadMentorReferralCommissionStats() {
    const loadingEl = document.getElementById("mentor-wallet-referral-loading");
    const errorEl = document.getElementById("mentor-wallet-referral-error");
    const statsEl = document.getElementById("mentor-wallet-referral-stats");
    if (!currentUser?.id) return;

    if (loadingEl) loadingEl.hidden = false;
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.hidden = true;
      errorEl.classList.add("empty");
      errorEl.classList.remove("profile-message-error");
    }
    if (statsEl) statsEl.hidden = true;

    const { data, error } = await supabase.rpc("get_my_mentor_referral_commission_stats");
    if (error) {
      console.error("get_my_mentor_referral_commission_stats:", error.message);
      if (loadingEl) loadingEl.hidden = true;
      if (errorEl) {
        errorEl.textContent = error.message?.includes("get_my_mentor_referral_commission_stats")
          ? "Davet komisyonu istatistikleri için SQL dosyasını çalıştırın."
          : "Davet komisyonu yüklenemedi.";
        errorEl.hidden = false;
        errorEl.classList.remove("empty");
        errorEl.classList.add("profile-message-error");
      }
      return;
    }

    renderMentorReferralCommissionStats(data);
  }

  function formatWalletDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("tr-TR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function mapPayoutRequestStatus(status) {
    const map = {
      pending: "Beklemede",
      processing: "İşleniyor",
      completed: "Ödendi",
      rejected: "Reddedildi",
      canceled: "İptal",
    };
    return map[String(status || "")] || String(status || "—");
  }

  function setWalletPayoutListMessage(text, isError = false) {
    const el = document.getElementById("mentor-wallet-payout-list-message");
    if (!el) return;
    const hasText = Boolean(text);
    el.textContent = text || "";
    el.hidden = !hasText;
    el.classList.toggle("empty", !hasText);
    el.classList.toggle("profile-message-error", Boolean(hasText && isError));
  }

  async function downloadMentorPayoutInvoice(requestId) {
    if (!requestId) return;
    setWalletPayoutListMessage("Gider pusulası hazırlanıyor…");
    const result = await supabase.functions.invoke("get-mentor-payout-invoice", {
      body: { requestId },
    });
    const parsed = await readSupabaseFunctionResult(result);
    if (parsed.errorCode || result.error) {
      console.error("get-mentor-payout-invoice:", parsed.errorCode, parsed.errorMessage);
      setWalletPayoutListMessage(
        parsed.errorMessage || "Gider pusulası indirilemedi.",
        true,
      );
      return;
    }
    const url = parsed.data?.signed_url;
    if (!url) {
      setWalletPayoutListMessage("Gider pusulası bağlantısı alınamadı.", true);
      return;
    }
    setWalletPayoutListMessage("");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function setWalletPayoutMessage(text, isError = false) {
    const el = document.getElementById("mentor-wallet-payout-message");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("empty", !text);
    el.classList.toggle("profile-message-error", Boolean(text && isError));
  }

  function isSelfBillingAgreed() {
    return Boolean(document.getElementById("mentor-wallet-self-billing-agree")?.checked);
  }

  function canRequestMentorPayout({
    payoutReady = false,
    available = 0,
    amount = null,
  } = {}) {
    const minAmount = getMentorPayoutMinAmount();
    if (amount == null) return false;
    if (amount < minAmount || amount > available) return false;
    return payoutReady && isSelfBillingAgreed();
  }

  function updateMentorPayoutButtonState() {
    const payoutBtn = document.getElementById("mentor-wallet-payout-btn");
    if (!payoutBtn || !lastWalletSummary) return;

    const amount = getMentorPayoutRequestAmount();
    const available = Number(lastWalletSummary.available_balance) || 0;
    const payoutReady = window.RekabetliMentorVitrin?.hasPayoutBankDetails?.({
      payoutReady: pageData.payout_ready,
      accountHolder: pageData.payout_account_holder,
      bankName: pageData.payout_bank_name,
      iban: pageData.payout_iban,
    });

    payoutBtn.disabled = !canRequestMentorPayout({ payoutReady, available, amount });
  }

  function getWalletListPageCount(totalItems) {
    return Math.max(1, Math.ceil(totalItems / WALLET_LIST_PAGE_SIZE));
  }

  function getWalletListSlice(items, page) {
    const totalPages = getWalletListPageCount(items.length);
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const start = safePage * WALLET_LIST_PAGE_SIZE;
    return {
      items: items.slice(start, start + WALLET_LIST_PAGE_SIZE),
      page: safePage,
      totalPages,
    };
  }

  function renderWalletListPager(pagerEl, labelEl, prevBtn, nextBtn, page, totalItems) {
    const totalPages = getWalletListPageCount(totalItems);
    const showPager = totalItems > WALLET_LIST_PAGE_SIZE;
    if (pagerEl) pagerEl.hidden = !showPager;
    if (labelEl) labelEl.textContent = `${page + 1} / ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 0;
    if (nextBtn) nextBtn.disabled = page >= totalPages - 1;
  }

  function buildWalletTransactionItem(row, commissionPct) {
    const item = document.createElement("li");
    item.className = "mentor-wallet-transaction";

    const head = document.createElement("div");
    head.className = "mentor-wallet-transaction-head";

    const title = document.createElement("p");
    title.className = "mentor-wallet-transaction-title";
    if (row.entry_type === "referral_bonus") {
      title.textContent = "Davet komisyonu (Affiliate)";
    } else if (row.entry_type === "referral_bonus_refund") {
      title.textContent = "Davet komisyonu iadesi";
    } else if (row.entry_type === "refund") {
      title.textContent = `Paket iadesi · ${row.package_title || "Paket"}`;
    } else {
      title.textContent = getWalletSaleTitle(row);
    }

    const net = document.createElement("p");
    net.className = "mentor-wallet-transaction-net";
    if (row.entry_type === "refund") {
      net.classList.add("is-refund");
    }
    net.textContent = formatTryMoney(row.net_amount);

    head.append(title, net);

    const meta = document.createElement("p");
    meta.className = "mentor-wallet-transaction-meta";
    const student = row.student_display_name || "Öğrenci";
    let metaText = `${student} · ${formatWalletDate(row.created_at)}`;
    if (row.entry_type === "refund") {
      metaText += " · İade edildi";
    } else if (
      (row.entry_type === "package_sale" || row.entry_type === "referral_bonus")
      && row.is_withdrawable === false
    ) {
      if (row.is_renewal && row.withdrawable_at) {
        metaText += ` · Yenileme · Çekilebilir: ${formatWalletDate(row.withdrawable_at)}`;
      } else if (isWalletWaitingFirstMeeting(row)) {
        metaText += " · İlk görüşme planlanmadı";
      } else if (row.withdrawable_at) {
        metaText += ` · Çekilebilir: ${formatWalletDate(row.withdrawable_at)}`;
      } else if (row.first_meeting_at) {
        metaText += ` · İlk görüşme: ${formatWalletDate(row.first_meeting_at)}`;
      }
    }
    meta.textContent = metaText;

    const fees = document.createElement("dl");
    fees.className = "mentor-wallet-transaction-fees";

    const referralRatePct = 5;
    const feeRows = row.entry_type === "referral_bonus"
      ? [
          { label: "Paket", value: row.package_title?.replace(/^Davet komisyonu · /, "") || "—" },
          { label: `Affiliate (%${referralRatePct})`, value: formatTryMoney(row.net_amount) },
        ]
      : row.entry_type === "referral_bonus_refund"
        ? [{ label: "İade", value: formatTryMoney(row.net_amount) }]
        : row.entry_type === "refund"
          ? [{ label: "Durum", value: "İade edildi" }]
          : [
            { label: "Brüt", value: formatTryMoney(row.gross_amount) },
            {
              label: row.platform_fee > 0 && row.gross_amount > 0
                && Math.abs((row.platform_fee / row.gross_amount) * 100 - commissionPct) > 0.5
                ? `Komisyon (%${Math.round((row.platform_fee / row.gross_amount) * 1000) / 10})`
                : `Komisyon (%${commissionPct})`,
              value: formatTryMoney(row.platform_fee),
            },
          ];

    feeRows.forEach((fee) => {
      const feeItem = document.createElement("div");
      feeItem.className = "mentor-wallet-transaction-fee";

      const dt = document.createElement("dt");
      dt.textContent = fee.label;

      const dd = document.createElement("dd");
      dd.textContent = fee.value;

      feeItem.append(dt, dd);
      fees.appendChild(feeItem);
    });

    item.append(head, meta, fees);
    return item;
  }

  function buildWalletPayoutItem(row) {
    const item = document.createElement("li");
    item.className = "mentor-wallet-payout-item";

    const main = document.createElement("div");
    main.className = "mentor-wallet-payout-main";

    const title = document.createElement("p");
    title.className = "mentor-wallet-payout-title";
    title.textContent = formatTryMoney(row.amount_net);

    const meta = document.createElement("p");
    meta.className = "mentor-wallet-payout-meta";
    const feeNote =
      Number(row.transfer_fee) > 0 ? ` · Ücret ${formatTryMoney(row.transfer_fee)}` : "";
    const invoiceNote = row.invoice_number ? ` · ${row.invoice_number}` : "";
    meta.textContent =
      `${mapPayoutRequestStatus(row.status)} · ${formatWalletDate(row.created_at)}${feeNote}${invoiceNote}`;

    main.append(title, meta);
    item.appendChild(main);

    if (row.status === "completed") {
      const actions = document.createElement("div");
      actions.className = "mentor-wallet-payout-actions";
      const invoiceBtn = document.createElement("button");
      invoiceBtn.type = "button";
      invoiceBtn.className = "secondary mentor-wallet-invoice-btn";
      invoiceBtn.textContent = "Gider pusulası";
      invoiceBtn.addEventListener("click", () => {
        void downloadMentorPayoutInvoice(row.id);
      });
      actions.appendChild(invoiceBtn);
      item.appendChild(actions);
    }

    return item;
  }

  function renderWalletTransactionsPage() {
    const emptyEl = document.getElementById("mentor-wallet-empty");
    const listEl = document.getElementById("mentor-wallet-transactions");
    const pagerEl = document.getElementById("mentor-wallet-transactions-pager");
    const labelEl = document.getElementById("mentor-wallet-transactions-page");
    const prevBtn = document.getElementById("mentor-wallet-transactions-prev");
    const nextBtn = document.getElementById("mentor-wallet-transactions-next");
    if (!emptyEl || !listEl) return;

    const commissionPct = Number(lastWalletSummary?.commission_rate_pct) || 20;
    const { items, page } = getWalletListSlice(walletTransactionsCache, walletTransactionPage);
    walletTransactionPage = page;

    listEl.replaceChildren();
    if (!walletTransactionsCache.length) {
      emptyEl.hidden = false;
      listEl.hidden = true;
      if (pagerEl) pagerEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    listEl.hidden = false;
    items.forEach((row) => {
      listEl.appendChild(buildWalletTransactionItem(row, commissionPct));
    });
    renderWalletListPager(
      pagerEl,
      labelEl,
      prevBtn,
      nextBtn,
      page,
      walletTransactionsCache.length,
    );
  }

  function renderWalletPayoutsPage() {
    const emptyEl = document.getElementById("mentor-wallet-payout-empty");
    const listEl = document.getElementById("mentor-wallet-payout-requests");
    const pagerEl = document.getElementById("mentor-wallet-payout-pager");
    const labelEl = document.getElementById("mentor-wallet-payout-page");
    const prevBtn = document.getElementById("mentor-wallet-payout-prev");
    const nextBtn = document.getElementById("mentor-wallet-payout-next");
    if (!emptyEl || !listEl) return;

    const { items, page } = getWalletListSlice(walletPayoutRequestsCache, walletPayoutPage);
    walletPayoutPage = page;

    listEl.replaceChildren();
    if (!walletPayoutRequestsCache.length) {
      emptyEl.hidden = false;
      listEl.hidden = true;
      if (pagerEl) pagerEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    listEl.hidden = false;
    items.forEach((row) => {
      listEl.appendChild(buildWalletPayoutItem(row));
    });
    renderWalletListPager(
      pagerEl,
      labelEl,
      prevBtn,
      nextBtn,
      page,
      walletPayoutRequestsCache.length,
    );
  }

  function getWalletSaleTitle(row) {
    const title = row.package_title || "Paket";
    if (row.is_renewal) return `Paket yenilemesi · ${title}`;
    return title;
  }

  function getWalletHeldItemTitle(row) {
    if (row.entry_type === "referral_bonus") return "Davet komisyonu (Affiliate)";
    if (row.entry_type === "referral_bonus_refund") return "Davet komisyonu iadesi";
    if (row.entry_type === "refund") return `Paket iadesi · ${row.package_title || "Paket"}`;
    if (row.entry_type === "package_sale") return getWalletSaleTitle(row);
    return row.package_title || "Paket satışı";
  }

  function isWalletWaitingFirstMeeting(row) {
    if (row?.is_renewal) return false;
    return (
      row?.payout_hold_reason === "waiting_first_meeting"
      || (!row?.first_meeting_at && !row?.withdrawable_at)
    );
  }

  function formatWalletHeldMeta(row, holdDays) {
    const student = row.student_display_name || "Öğrenci";
    if (row.entry_type === "refund" || row.entry_type === "referral_bonus_refund") {
      return `${student} · İade edildi`;
    }
    if (row.is_renewal) {
      let metaText = `${student} · Yenileme`;
      if (row.withdrawable_at) {
        metaText += ` · Çekilebilir: ${formatWalletDate(row.withdrawable_at)}`;
      } else {
        metaText += ` · Ödemeden ${holdDays} gün sonra çekilebilir`;
      }
      return metaText;
    }
    if (isWalletWaitingFirstMeeting(row)) {
      return `${student} · İlk görüşme planlanmadı`;
    }
    if (row.first_meeting_at) {
      let metaText = `${student} · İlk görüşme: ${formatWalletDate(row.first_meeting_at)}`;
      if (row.withdrawable_at) {
        metaText += ` · Çekilebilir: ${formatWalletDate(row.withdrawable_at)}`;
      } else {
        metaText += ` · İlk görüşmeden ${holdDays} gün sonra çekilebilir`;
      }
      return metaText;
    }
    if (row.withdrawable_at) {
      return `${student} · Çekilebilir: ${formatWalletDate(row.withdrawable_at)}`;
    }
    return `${student} · İlk görüşmeden ${holdDays} gün sonra çekilebilir`;
  }

  function sortWalletHeldItems(items) {
    return [...items].sort((a, b) => {
      const aWaiting = isWalletWaitingFirstMeeting(a);
      const bWaiting = isWalletWaitingFirstMeeting(b);
      if (aWaiting !== bWaiting) return aWaiting ? -1 : 1;
      const aTime = a.withdrawable_at ? new Date(a.withdrawable_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.withdrawable_at ? new Date(b.withdrawable_at).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }

  function renderMentorWalletHeldBalance(summary) {
    const heldWrap = document.getElementById("mentor-wallet-held-wrap");
    const heldLabelEl = document.getElementById("mentor-wallet-held-label");
    const heldEl = document.getElementById("mentor-wallet-held-balance");
    const heldListEl = document.getElementById("mentor-wallet-held-list");
    if (!heldWrap || !heldEl || !heldListEl) return;

    const heldBalance = Number(summary?.held_balance) || 0;
    const holdDays = Number(summary?.payout_hold_days) || 14;
    let heldItems = Array.isArray(summary?.held_balance_items) ? summary.held_balance_items : [];
    if (
      !heldItems.length
      && heldBalance > 0
      && Array.isArray(summary?.transactions)
    ) {
      heldItems = sortWalletHeldItems(
        summary.transactions.filter(
          (row) =>
            (row.entry_type === "package_sale"
              || row.entry_type === "referral_bonus"
              || row.entry_type === "refund"
              || row.entry_type === "referral_bonus_refund")
            && row.is_withdrawable === false,
        ),
      );
    } else {
      heldItems = sortWalletHeldItems(heldItems);
    }

    if (heldBalance <= 0) {
      heldWrap.hidden = true;
      heldListEl.replaceChildren();
      return;
    }

    heldWrap.hidden = false;
    if (heldLabelEl) {
      heldLabelEl.textContent = `Bekleyen bakiye (ilk görüşme + ${holdDays} gün)`;
    }
    heldEl.textContent = formatTryMoney(heldBalance);
    heldListEl.replaceChildren();

    heldItems.forEach((row) => {
      const item = document.createElement("li");
      item.className = "mentor-wallet-held-item";

      const main = document.createElement("div");
      main.className = "mentor-wallet-held-item-main";

      const title = document.createElement("p");
      title.className = "mentor-wallet-held-item-title";
      title.textContent = getWalletHeldItemTitle(row);

      const meta = document.createElement("p");
      meta.className = "mentor-wallet-held-item-meta";
      meta.textContent = formatWalletHeldMeta(row, holdDays);

      const amount = document.createElement("p");
      amount.className = "mentor-wallet-held-item-amount";
      amount.textContent = formatTryMoney(row.net_amount);

      main.append(title, meta);
      item.append(main, amount);
      heldListEl.appendChild(item);
    });
  }

  function renderMentorWallet(summary) {
    lastWalletSummary = summary;
    const balanceEl = document.getElementById("mentor-wallet-balance");
    const statsEl = document.getElementById("mentor-wallet-stats");
    const noteEl = document.getElementById("mentor-wallet-balance-note");
    const payoutWrap = document.getElementById("mentor-wallet-payout-request");
    const payoutBtn = document.getElementById("mentor-wallet-payout-btn");
    const payoutHint = document.getElementById("mentor-wallet-payout-hint");

    if (!summary) {
      if (balanceEl) balanceEl.textContent = "—";
      return;
    }

    const available = Number(summary.available_balance) || 0;
    const heldBalance = Number(summary.held_balance) || 0;
    const holdDays = Number(summary.payout_hold_days) || 14;
    const commissionPct = Number(summary.commission_rate_pct) || 20;
    const minAmount = getMentorPayoutMinAmount();
    const requestAmount = getMentorPayoutRequestAmount();
    const transactions = Array.isArray(summary.transactions) ? summary.transactions : [];
    const payoutRequests = Array.isArray(summary.payout_requests) ? summary.payout_requests : [];

    if (balanceEl) balanceEl.textContent = formatTryMoney(available);

    renderMentorWalletHeldBalance(summary);

    if (statsEl) {
      statsEl.hidden = false;
      statsEl.replaceChildren();

      const items = [
        { label: "Toplam satış", value: String(summary.sale_count || 0) },
        { label: "Brüt gelir", value: formatTryMoney(summary.total_gross) },
        { label: "Net gelir", value: formatTryMoney(summary.total_net) },
      ];
      if (Number(summary.referral_bonus_total) !== 0) {
        items.push({
          label: "Davet komisyonu (net)",
          value: formatTryMoney(summary.referral_bonus_total),
        });
      }
      items.push(
        { label: "Bekleyen", value: formatTryMoney(heldBalance) },
        { label: "Komisyon", value: `%${commissionPct}` },
      );

      items.forEach((item) => {
        const chip = document.createElement("div");
        chip.className = "mentor-wallet-stat";
        const label = document.createElement("span");
        label.className = "mentor-wallet-stat-label";
        label.textContent = item.label;
        const value = document.createElement("strong");
        value.className = "mentor-wallet-stat-value";
        value.textContent = item.value;
        chip.append(label, value);
        statsEl.appendChild(chip);
      });
    }

    if (noteEl) {
      noteEl.textContent = `Mentör payı liste fiyatının %${commissionPct} komisyon düşüldükten sonraki tutardır. Onaylanan ilk görüşmeden ${holdDays} gün sonra çekilebilir hale gelir; görüşme planlanmadan ödeme talep edilemez. ${MENTOR_PAYOUT_FEE_NOTE}`;
    }

    updateMentorPayoutAmountFieldLimits();

    const payoutReady = window.RekabetliMentorVitrin?.hasPayoutBankDetails?.({
      payoutReady: pageData.payout_ready,
      accountHolder: pageData.payout_account_holder,
      bankName: pageData.payout_bank_name,
      iban: pageData.payout_iban,
    });

    if (payoutWrap && payoutBtn && payoutHint) {
      payoutWrap.hidden = false;
      payoutBtn.disabled = !canRequestMentorPayout({
        payoutReady,
        available,
        amount: requestAmount,
      });

      if (!payoutReady) {
        payoutHint.textContent = "Ödeme talebi için önce hesap bilgilerinizi kaydedin.";
      } else if (!isSelfBillingAgreed()) {
        payoutHint.textContent = "Ödeme talebi için onay kutusunu işaretleyin.";
      } else if (available <= 0 && heldBalance > 0) {
        const heldItemsForHint = Array.isArray(summary.held_balance_items)
          ? summary.held_balance_items
          : transactions.filter(
              (row) =>
                (row.entry_type === "package_sale" || row.entry_type === "referral_bonus")
                && row.is_withdrawable === false,
            );
        const hasWaitingMeeting = heldItemsForHint.some((row) => isWalletWaitingFirstMeeting(row));
        payoutHint.textContent = hasWaitingMeeting
          ? `${formatTryMoney(heldBalance)} tutarınız bekliyor. İlk görüşmeyi planladıktan sonra ${holdDays} günlük süre başlar.`
          : `${formatTryMoney(heldBalance)} tutarınız ilk görüşmeden sonra ${holdDays} günlük bekleme süresinde. Süre dolunca çekilebilir bakiyenize aktarılır.`;
      } else if (available <= 0) {
        payoutHint.textContent = "Kullanılabilir bakiyeniz yok.";
      } else if (available < minAmount) {
        payoutHint.textContent = `Ödeme talebi için en az ${formatTryMoney(minAmount)} çekilebilir bakiye gerekir.`;
      } else if (requestAmount == null) {
        payoutHint.textContent = `Çekmek istediğiniz tutarı girin (min. ${formatTryMoney(minAmount)}).`;
      } else if (requestAmount < minAmount) {
        payoutHint.textContent = `Minimum ödeme tutarı ${formatTryMoney(minAmount)}.`;
      } else if (requestAmount > available) {
        payoutHint.textContent = `En fazla ${formatTryMoney(available)} çekebilirsiniz.`;
      } else {
        payoutHint.textContent = `${formatTryMoney(requestAmount)} için talep oluşturabilirsiniz. ${MENTOR_PAYOUT_FEE_NOTE}`;
      }
    }

    walletTransactionsCache = transactions;
    walletPayoutRequestsCache = payoutRequests;
    walletTransactionPage = 0;
    walletPayoutPage = 0;
    renderWalletTransactionsPage();
    renderWalletPayoutsPage();
  }

  async function loadMentorWallet() {
    if (!currentUser?.id) return;

    const balanceEl = document.getElementById("mentor-wallet-balance");
    if (balanceEl) balanceEl.textContent = "Yükleniyor…";

    const { data, error } = await supabase.rpc("get_mentor_wallet_summary");

    if (error) {
      console.error("mentor wallet:", error.message);
      if (balanceEl) balanceEl.textContent = "—";
      const noteEl = document.getElementById("mentor-wallet-balance-note");
      if (noteEl) {
        noteEl.textContent = error.message?.includes("get_mentor_wallet_summary")
          ? "Cüzdan için supabase-mentor-wallet.sql dosyasını çalıştırın."
          : "Cüzdan yüklenemedi.";
      }
      return;
    }

    renderMentorWallet(data);
    void loadMentorReferralCommissionStats();
  }

  async function requestMentorWalletPayout() {
    if (!currentUser?.id) return;

    const payoutBtn = document.getElementById("mentor-wallet-payout-btn");
    setWalletPayoutMessage("");

    if (!isSelfBillingAgreed()) {
      setWalletPayoutMessage("Ödeme talebi için onay kutusunu işaretlemeniz gerekir.", true);
      updateMentorPayoutButtonState();
      return;
    }

    const requestAmount = getMentorPayoutRequestAmount();
    const minAmount = getMentorPayoutMinAmount();
    const available = Number(lastWalletSummary?.available_balance) || 0;

    if (requestAmount == null) {
      setWalletPayoutMessage("Lütfen çekmek istediğiniz tutarı girin.", true);
      updateMentorPayoutButtonState();
      return;
    }

    if (requestAmount < minAmount) {
      setWalletPayoutMessage(`Minimum ödeme tutarı ${formatTryMoney(minAmount)}.`, true);
      updateMentorPayoutButtonState();
      return;
    }

    if (requestAmount > available) {
      setWalletPayoutMessage(`En fazla ${formatTryMoney(available)} çekebilirsiniz.`, true);
      updateMentorPayoutButtonState();
      return;
    }

    const confirmed = await window.rekabetliConfirm?.({
      title: "Ödeme talebi",
      message:
        `${formatTryMoney(requestAmount)} için ödeme talebi oluşturulsun mu? ${MENTOR_PAYOUT_FEE_NOTE}`,
      confirmLabel: "Talep oluştur",
    });
    if (!confirmed) return;

    if (payoutBtn) payoutBtn.disabled = true;
    setWalletPayoutMessage("Talep oluşturuluyor…");

    const { data, error } = await supabase.functions.invoke("create-mentor-payout", {
      body: { self_billing_agreed: true, amount: requestAmount },
    });

    if (payoutBtn) updateMentorPayoutButtonState();

    const parsed = await readSupabaseFunctionResult({ data, error });
    if (parsed.errorCode || error) {
      const friendly = formatPayoutFunctionError(parsed.errorCode, parsed.errorMessage);
      setWalletPayoutMessage(
        friendly.startsWith("Wise API")
          ? friendly
          : `Talep oluşturulamadı: ${friendly}`,
        true,
      );
      return;
    }

    const payoutData = parsed.data;
    const net = formatTryMoney(payoutData?.amount_net);
    setWalletPayoutMessage(
      `Ödeme talebiniz alındı. Ekibimiz onayladıktan sonra ${net} tutarı hesabınıza aktarılacak.`,
    );

    await loadMentorWallet();
    const amountInput = document.getElementById("mentor-wallet-payout-amount");
    if (amountInput) amountInput.value = "";
    const selfBillingCheckbox = document.getElementById("mentor-wallet-self-billing-agree");
    if (selfBillingCheckbox) selfBillingCheckbox.checked = false;
    updateMentorPayoutButtonState();
  }

  function initMentorWallet() {
    const payoutBtn = document.getElementById("mentor-wallet-payout-btn");
    const selfBillingCheckbox = document.getElementById("mentor-wallet-self-billing-agree");
    const payoutAmountInput = document.getElementById("mentor-wallet-payout-amount");
    const payoutMaxBtn = document.getElementById("mentor-wallet-payout-max-btn");

    payoutAmountInput?.addEventListener("input", () => {
      updateMentorPayoutButtonState();
      if (lastWalletSummary) renderMentorWallet(lastWalletSummary);
    });
    payoutAmountInput?.addEventListener("change", () => {
      updateMentorPayoutButtonState();
      if (lastWalletSummary) renderMentorWallet(lastWalletSummary);
    });
    payoutMaxBtn?.addEventListener("click", () => {
      const available = Number(lastWalletSummary?.available_balance) || 0;
      if (!payoutAmountInput || available <= 0) return;
      payoutAmountInput.value = String(available);
      updateMentorPayoutButtonState();
      if (lastWalletSummary) renderMentorWallet(lastWalletSummary);
    });

    payoutBtn?.addEventListener("click", () => {
      void requestMentorWalletPayout();
    });
    selfBillingCheckbox?.addEventListener("change", () => {
      updateMentorPayoutButtonState();
    });

    const txPrev = document.getElementById("mentor-wallet-transactions-prev");
    const txNext = document.getElementById("mentor-wallet-transactions-next");
    if (txPrev && !txPrev.dataset.bound) {
      txPrev.dataset.bound = "1";
      txPrev.addEventListener("click", () => {
        walletTransactionPage -= 1;
        renderWalletTransactionsPage();
      });
    }
    if (txNext && !txNext.dataset.bound) {
      txNext.dataset.bound = "1";
      txNext.addEventListener("click", () => {
        walletTransactionPage += 1;
        renderWalletTransactionsPage();
      });
    }

    const payoutPrev = document.getElementById("mentor-wallet-payout-prev");
    const payoutNext = document.getElementById("mentor-wallet-payout-next");
    if (payoutPrev && !payoutPrev.dataset.bound) {
      payoutPrev.dataset.bound = "1";
      payoutPrev.addEventListener("click", () => {
        walletPayoutPage -= 1;
        renderWalletPayoutsPage();
      });
    }
    if (payoutNext && !payoutNext.dataset.bound) {
      payoutNext.dataset.bound = "1";
      payoutNext.addEventListener("click", () => {
        walletPayoutPage += 1;
        renderWalletPayoutsPage();
      });
    }
  }

  async function loadMentorPage(userId) {
    const { data, error } = await supabase
      .from("mentor_pages")
      .select(
        "photo_url, vitrin_accent, about, branches, private_lessons, packages, meeting_platform, meeting_link, payout_ready, vitrin_active, vitrin_review_status, vitrin_review_note",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      if (error.message?.includes("mentor_pages")) {
        throw new Error(
          "mentor_pages tablosu bulunamadı. supabase-mentor-pages.sql dosyasını Supabase SQL Editor'da çalıştırın.",
        );
      }
      throw error;
    }

    pageData = {
      photo_url:
        data?.photo_url?.trim() && window.RekabetliSecurity?.isSafeHttpUrl?.(data.photo_url.trim())
          ? data.photo_url.trim()
          : null,
      vitrin_accent: window.RekabetliMentorVitrin?.sanitizeAccent?.(data?.vitrin_accent) || null,
      about: window.RekabetliSecurity?.sanitizeMultilinePlainText
        ? window.RekabetliSecurity.sanitizeMultilinePlainText(data?.about, 3000)
        : data?.about?.trim() || null,
      branches: normalizeItems(data?.branches, "branch"),
      private_lessons: normalizeItems(data?.private_lessons, "lesson"),
      packages: normalizePackages(data?.packages),
      meeting_platform:
        window.RekabetliMentorVitrin?.sanitizeMeetingPlatform?.(data?.meeting_platform) ||
        "google_meet",
      meeting_link:
        window.RekabetliMentorVitrin?.sanitizeMeetingLink?.(
          data?.meeting_platform,
          data?.meeting_link,
        ) || null,
      payout_ready: Boolean(data?.payout_ready),
      vitrin_active: data?.vitrin_active !== false,
      vitrin_review_status:
        window.RekabetliMentorVitrin?.normalizeVitrinReviewStatus?.(data?.vitrin_review_status) ||
        "draft",
      vitrin_review_note: data?.vitrin_review_note?.trim() || null,
      payout_account_holder: null,
      payout_bank_name: null,
      payout_iban: null,
    };

    await loadMentorPayoutAccount(userId);
  }

  async function saveMentorPage(patch, options = {}) {
    const quiet = options.quiet === true;
    const refreshEditors = options.refreshEditors !== false;

    if (!currentUser || saving) return false;
    saving = true;
    if (!quiet) setMessage("Kaydediliyor…");

    try {
      const normalizedPatch = { ...patch };
      if (patch.branches) normalizedPatch.branches = normalizeItems(patch.branches, "branch");
      if (patch.private_lessons) {
        normalizedPatch.private_lessons = normalizeItems(patch.private_lessons, "lesson");
      }
      if (patch.packages) normalizedPatch.packages = normalizePackages(patch.packages);
      if (patch.vitrin_accent !== undefined) {
        const vitrin = window.RekabetliMentorVitrin;
        normalizedPatch.vitrin_accent =
          vitrin?.sanitizeAccent?.(patch.vitrin_accent) || vitrin?.resolveVitrinAccent?.(null);
      }
      if (patch.meeting_platform !== undefined) {
        const vitrin = window.RekabetliMentorVitrin;
        normalizedPatch.meeting_platform =
          vitrin?.sanitizeMeetingPlatform?.(patch.meeting_platform) || null;
      }
      if (patch.meeting_link !== undefined || patch.meeting_platform !== undefined) {
        const vitrin = window.RekabetliMentorVitrin;
        const platform =
          normalizedPatch.meeting_platform ??
          pageData.meeting_platform ??
          "google_meet";
        const linkRaw =
          patch.meeting_link !== undefined ? patch.meeting_link : pageData.meeting_link;
        normalizedPatch.meeting_link = linkRaw
          ? vitrin?.sanitizeMeetingLink?.(platform, linkRaw) || null
          : null;
      }
      if (patch.vitrin_active !== undefined) {
        normalizedPatch.vitrin_active = patch.vitrin_active !== false;
      }

      const row = {
        user_id: currentUser.id,
        ...normalizedPatch,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("mentor_pages").upsert(row, {
        onConflict: "user_id",
      });

      if (error) throw error;

      pageData = { ...pageData, ...normalizedPatch };

      if (patch.packages !== undefined) {
        void renderPackageNavAndPanels();
      }

      if (refreshEditors) {
        renderAll();
      } else {
        renderSummaries();
        renderVitrinDisplays();
        if (patch.about !== undefined) renderAbout();
      }

      if (!quiet) {
        setMessage("Kaydedildi.");
      } else {
        setMessage("");
      }
      return true;
    } catch (error) {
      console.error("mentor page save:", error);
      setMessage(error.message || "Kaydedilemedi.", true);
      return false;
    } finally {
      saving = false;
    }
  }

  async function prepareImageFile(file, maxBytes, outputName) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error("Yalnızca JPG, PNG veya WebP yükleyebilirsiniz.");
    }

    let selected = file;
    if (
      selected.size > maxBytes &&
      window.RekabetliImageCompression?.compressImageFile
    ) {
      selected = await window.RekabetliImageCompression.compressImageFile(selected, {
        maxBytes,
        outputName,
      });
    }

    if (selected.size > maxBytes) {
      throw new Error("Görsel çok büyük. Lütfen daha küçük bir dosya seçin.");
    }

    return selected;
  }

  async function uploadImage(file, path) {
    if (window.RekabetliImageUploadLimit?.consumeUploadSlot) {
      await window.RekabetliImageUploadLimit.consumeUploadSlot(supabase, {
        bucket: AVATAR_BUCKET,
        path,
      });
    }

    const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "3600",
    });

    if (error) {
      if (window.RekabetliImageUploadLimit?.isLimitError(error)) {
        throw new Error(window.RekabetliImageUploadLimit.getLimitMessage(error));
      }
      throw error;
    }

    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  }

  function fileExtension(file) {
    if (file.type === "image/png") return "png";
    if (file.type === "image/webp") return "webp";
    return "jpg";
  }

  async function handleImageUpload(file) {
    if (!file || !currentUser) return;

    const outputName = "mentor-photo.webp";
    const path = `${currentUser.id}/mentor-photo.${fileExtension(file)}`;

    try {
      const prepared = await prepareImageFile(file, MAX_PHOTO_BYTES, outputName);
      const url = await uploadImage(prepared, path);
      await saveMentorPage({ photo_url: url }, { quiet: true });
    } catch (error) {
      console.error("mentor photo upload:", error);
      setMessage(error.message || "Görsel yüklenemedi.", true);
    }
  }

  function openAboutModal() {
    if (!aboutModal || !aboutInput) return;
    aboutInput.value = pageData.about || "";
    aboutModal.hidden = false;
    aboutInput.focus();
  }

  function closeAboutModal() {
    if (aboutModal) aboutModal.hidden = true;
  }

  photoEditBtn?.addEventListener("click", () => photoInput?.click());

  photoInput?.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    photoInput.value = "";
    await handleImageUpload(file);
  });

  aboutEditBtn?.addEventListener("click", openAboutModal);
  aboutModalClose?.addEventListener("click", closeAboutModal);
  aboutCancelBtn?.addEventListener("click", closeAboutModal);

  aboutModal?.addEventListener("click", (event) => {
    if (event.target === aboutModal) closeAboutModal();
  });

  aboutForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const sec = window.RekabetliSecurity;
    if (sec?.containsMarkupAttempt?.(aboutInput.value)) {
      setMessage("HTML, script veya geçersiz bağlantı içeriği kullanılamaz.", true);
      return;
    }
    const about = sec?.sanitizeMultilinePlainText
      ? sec.sanitizeMultilinePlainText(aboutInput.value, 3000)
      : aboutInput.value.trim().slice(0, 3000);

    await saveMentorPage({ about: about || null }, { quiet: true });
    closeAboutModal();
  });

  addBranchBtn?.addEventListener("click", () => {
    void addItem("branch");
  });

  addLessonBtn?.addEventListener("click", () => {
    void addItem("lesson");
  });

  addPackageBtn?.addEventListener("click", () => {
    void addPackage();
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (
      event.target.closest(".mentor-info-btn") ||
      event.target.closest(".mentor-price-info-box")
    ) {
      return;
    }
    closeAllPriceInfoBoxes();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (previewMode) {
        exitPreviewMode();
        return;
      }
      closeAllPriceInfoBoxes();
    }
  });

  const PACKAGE_STUDENT_MARKER = "-ogrenci-";

  function parseStudentId(value) {
    const id = String(value || "").trim();
    return window.RekabetliSecurity?.isValidUuid?.(id) ? id : "";
  }

  let pendingScheduleDeepLink = null;

  function cleanScheduleUrlParams() {
    const url = new URL(window.location.href);
    let changed = false;
    ["enrollment", "scheduleStudent", "schedulePackage", "openSchedule", "fromSale"].forEach((key) => {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    });
    if (changed) {
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  async function resolveScheduleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const openSchedule = params.get("openSchedule") === "1";
    const fromSale = params.get("fromSale") === "1";
    if (!openSchedule && !fromSale) return null;

    const enrollmentId = parseStudentId(params.get("enrollment"));
    let packageId = sanitizeItemId(params.get("schedulePackage"));
    let studentId = parseStudentId(params.get("scheduleStudent"));

    if (enrollmentId && currentUser?.id) {
      const { data, error } = await supabase
        .from("mentor_package_students")
        .select("student_id, package_id")
        .eq("id", enrollmentId)
        .eq("mentor_id", currentUser.id)
        .maybeSingle();
      if (!error && data) {
        packageId = sanitizeItemId(data.package_id);
        studentId = parseStudentId(data.student_id);
      }
    }

    if (!packageId || !studentId) return null;

    return {
      packageId,
      studentId,
      openSchedule: openSchedule || fromSale,
      fromSale,
    };
  }

  function packageStudentPanelId(packageId, studentId) {
    const safePkg = sanitizeItemId(packageId);
    const safeStudent = parseStudentId(studentId);
    if (!safePkg || !safeStudent) return "";
    return `paket-${safePkg}${PACKAGE_STUDENT_MARKER}${safeStudent}`;
  }

  function packageStudentRootId(packageId, studentId) {
    const safePkg = sanitizeItemId(packageId);
    const safeStudent = parseStudentId(studentId);
    if (!safePkg || !safeStudent) return "";
    return `mentor-package-student-root-${safePkg}--${safeStudent}`;
  }

  function parsePackageStudentPanel(panelId) {
    const raw = String(panelId || "");
    if (!raw.startsWith("paket-")) return null;
    const markerIdx = raw.indexOf(PACKAGE_STUDENT_MARKER);
    if (markerIdx === -1) return null;
    const packageId = sanitizeItemId(raw.slice(6, markerIdx));
    const studentId = parseStudentId(raw.slice(markerIdx + PACKAGE_STUDENT_MARKER.length));
    if (!packageId || !studentId) return null;
    return { packageId, studentId };
  }

  function isPackageOnlyPanel(panelId) {
    const raw = String(panelId || "");
    return raw.startsWith("paket-") && !raw.includes(PACKAGE_STUDENT_MARKER);
  }

  function openPackageStudentView({ packageId, studentId, displayName }) {
    const safePkg = sanitizeItemId(packageId);
    const safeStudent = parseStudentId(studentId);
    if (!safePkg || !safeStudent) return;

    ensurePackageStudentPanel({
      packageId: safePkg,
      studentId: safeStudent,
      displayName: displayName || "Öğrenci",
    });
    showPanel(packageStudentPanelId(safePkg, safeStudent));
  }

  function ensurePackageStudentPageHead(panelEl) {
    if (!panelEl) return null;
    let pageActions = panelEl.querySelector(".mentor-package-student-page-actions");
    if (pageActions) return pageActions;

    const titleEl = panelEl.querySelector(".mentor-package-student-page-title");
    if (!titleEl) return null;

    const pageHead = document.createElement("div");
    pageHead.className = "mentor-package-student-page-head";
    pageActions = document.createElement("div");
    pageActions.className = "mentor-package-student-page-actions";
    titleEl.replaceWith(pageHead);
    pageHead.append(titleEl, pageActions);
    return pageActions;
  }

  function ensurePackageStudentPanel({ packageId, studentId, displayName }) {
    const panelsRoot = document.getElementById("mentor-package-student-panels");
    if (!panelsRoot) return null;

    const panelId = packageStudentPanelId(packageId, studentId);
    const existing = document.querySelector(`[data-mentor-panel-view="${panelId}"]`);
    if (existing) {
      const titleEl = existing.querySelector(".mentor-package-student-page-title");
      if (titleEl) titleEl.textContent = displayName || "Öğrenci";
      const backBtn = existing.querySelector(".mentor-package-student-back");
      if (backBtn) backBtn.textContent = `← ${getPackageTitle(packageId)}`;
      ensurePackageStudentPageHead(existing);
      return existing;
    }

    const packageTitle = getPackageTitle(packageId);
    const section = document.createElement("section");
    section.id = `mentor-panel-${panelId}`;
    section.className = "mentor-panel-view mentor-package-student-view";
    section.dataset.mentorPanelView = panelId;
    section.hidden = true;
    section.setAttribute(
      "aria-label",
      `${displayName || "Öğrenci"} — ${packageTitle}`,
    );

    const main = document.createElement("main");
    main.className = "mentor-panel-grid-layout";

    const grid = document.createElement("div");
    grid.className = "mentor-panel-grid";

    const panel = document.createElement("section");
    panel.className = "mentor-panel-card mentor-panel-card--span-full mentor-package-student-panel";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "secondary mentor-package-student-back";
    backBtn.textContent = `← ${packageTitle}`;

    const pageHead = document.createElement("div");
    pageHead.className = "mentor-package-student-page-head";

    const title = document.createElement("h1");
    title.className = "mentor-package-student-page-title";
    title.textContent = displayName || "Öğrenci";

    const pageActions = document.createElement("div");
    pageActions.className = "mentor-package-student-page-actions";

    pageHead.append(title, pageActions);

    const root = document.createElement("div");
    root.id = packageStudentRootId(packageId, studentId);
    root.className = "mentor-package-student-root";

    backBtn.addEventListener("click", () => {
      showPanel(packagePanelId(packageId));
    });

    panel.append(backBtn, pageHead, root);
    grid.appendChild(panel);
    main.appendChild(grid);
    section.appendChild(main);
    panelsRoot.appendChild(section);
    return section;
  }

  async function mountPackageStudentView(packageId, studentId) {
    const safePkg = sanitizeItemId(packageId);
    const safeStudent = parseStudentId(studentId);
    const root = document.getElementById(packageStudentRootId(safePkg, safeStudent));
    const pkg = pageData.packages.find((item) => sanitizeItemId(item.id) === safePkg);
    if (!root || !pkg || !currentUser?.id || !window.RekabetliMentorMessaging?.mountPackageStudentPanel) {
      return;
    }

    const scheduleCtx = pendingScheduleDeepLink;
    pendingScheduleDeepLink = null;
    await window.RekabetliMentorMessaging.mountPackageStudentPanel({
      root,
      mentorId: currentUser.id,
      packageId: safePkg,
      packageTitle: pkg.title,
      studentId: safeStudent,
      openSchedule: scheduleCtx?.openSchedule === true,
      scheduleOnboarding: scheduleCtx?.fromSale === true,
      onBack: () => {
        showPanel(packagePanelId(safePkg));
      },
      onPackageChanged: async () => {
        await refreshPackageNavCounts();
        await loadLinkedStudents();
      },
    });
    cleanScheduleUrlParams();
  }

  let packageFillCounts = new Map();
  let packageEnrolledCounts = new Map();
  let showPanel = () => {};
  let packagesAccordionOpen = false;

  function setPackagesAccordionOpen(open) {
    packagesAccordionOpen = open;
    const group = document.querySelector('[data-mentor-nav-group="ogrenciler"]');
    const toggleBtn = group?.querySelector('[data-mentor-accordion-toggle="ogrenciler"]');
    const subnav = document.getElementById("mentor-package-subnav");
    group?.classList.toggle("is-open", open);
    toggleBtn?.setAttribute("aria-expanded", open ? "true" : "false");
    if (subnav) subnav.hidden = !open;
  }

  function packagePanelId(packageId) {
    return `paket-${sanitizeItemId(packageId)}`;
  }

  function parsePackageIdFromPanel(panelId) {
    const studentPanel = parsePackageStudentPanel(panelId);
    if (studentPanel) return studentPanel.packageId;
    const raw = String(panelId || "");
    if (!raw.startsWith("paket-")) return "";
    return sanitizeItemId(raw.slice(6));
  }

  function isKnownPanelId(panelId) {
    if (
      panelId === "profil" ||
      panelId === "sayfam" ||
      panelId === "ogrenciler" ||
      panelId === "cuzdanim" ||
      panelId === "hata-bildir"
    ) {
      return true;
    }
    if (parsePackageStudentPanel(panelId)) return true;
    return isPackageOnlyPanel(panelId) && Boolean(parsePackageIdFromPanel(panelId));
  }

  async function loadPackageEnrolledCounts() {
    if (!currentUser?.id) return new Map();

    const { data, error } = await supabase
      .from("mentor_package_students")
      .select("package_id")
      .eq("mentor_id", currentUser.id)
      .is("unenrolled_at", null);

    if (error) {
      console.warn("package enrolled counts:", error.message);
      return new Map();
    }

    const map = new Map();
    (data || []).forEach((row) => {
      const safeId = sanitizeItemId(row.package_id);
      if (!safeId) return;
      map.set(safeId, (map.get(safeId) || 0) + 1);
    });
    return map;
  }

  async function loadPackageFillCounts() {
    const vitrin = window.RekabetliMentorVitrin;
    if (!currentUser?.id || !vitrin?.fetchPackageFillCounts) return new Map();
    return vitrin.fetchPackageFillCounts(supabase, currentUser.id);
  }

  function createPackageSubnavButton(pkg, count) {
    const safeId = sanitizeItemId(pkg.id);
    const title = pkg.title?.trim() || "Paket";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mentor-panel-nav-btn mentor-panel-nav-btn--sub";
    btn.dataset.mentorPanel = packagePanelId(safeId);
    btn.setAttribute("aria-current", "false");

    const label = document.createElement("span");
    label.className = "mentor-panel-subnav-label";
    label.textContent = title;
    label.title = title;

    const countBadge = document.createElement("span");
    countBadge.className = "mentor-panel-subnav-count";
    countBadge.textContent = String(count);
    countBadge.setAttribute("aria-label", `${count} danışan / öğrenci`);

    btn.append(label, countBadge);
    return btn;
  }

  function createPackagePanelSection(pkg, count) {
    const safeId = sanitizeItemId(pkg.id);
    const panelId = packagePanelId(safeId);
    const title = pkg.title?.trim() || "Paket";

    const section = document.createElement("section");
    section.id = `mentor-panel-${panelId}`;
    section.className = "mentor-panel-view";
    section.dataset.mentorPanelView = panelId;
    section.hidden = true;
    section.setAttribute("aria-label", title);

    const main = document.createElement("main");
    main.className = "mentor-panel-grid-layout";

    const grid = document.createElement("div");
    grid.className = "mentor-panel-grid";

    const panel = document.createElement("section");
    panel.className = "mentor-panel-card mentor-panel-card--span-full mentor-students-panel";

    const heading = document.createElement("h1");
    heading.textContent = title;

    const countEl = document.createElement("p");
    countEl.id = `mentor-package-student-count-${safeId}`;
    countEl.className = "mentor-package-student-count";
    countEl.textContent = `${count} danışan / öğrenci`;

    const hint = document.createElement("p");
    hint.className = "profile-hint mentor-package-panel-hint";
    hint.textContent =
      "Bu pakete kod ile eklenen öğrenciler ve ön talepler aşağıda listelenir.";

    const root = document.createElement("div");
    root.id = `mentor-package-panel-root-${safeId}`;
    root.className = "mentor-package-panel-root";

    panel.append(heading, countEl, hint, root);
    grid.appendChild(panel);
    main.appendChild(grid);
    section.appendChild(main);
    return section;
  }

  async function renderPackageNavAndPanels() {
    const subnav = document.getElementById("mentor-package-subnav");
    const panelsRoot = document.getElementById("mentor-package-panels");
    if (!subnav || !panelsRoot) return;

    const [fillCounts, enrolledCounts] = await Promise.all([
      loadPackageFillCounts(),
      loadPackageEnrolledCounts(),
    ]);
    packageFillCounts = fillCounts;
    packageEnrolledCounts = enrolledCounts;
    subnav.replaceChildren();
    panelsRoot.replaceChildren();

    const packages = pageData.packages.filter((pkg) => pkg.title?.trim());
    if (!packages.length) {
      const empty = document.createElement("p");
      empty.className = "mentor-panel-subnav-empty";
      empty.textContent = "Henüz paket yok";
      subnav.appendChild(empty);
      subnav.hidden = !packagesAccordionOpen;
      return;
    }

    packages.forEach((pkg) => {
      const safeId = sanitizeItemId(pkg.id);
      const count = packageEnrolledCounts.get(safeId) || 0;
      subnav.appendChild(createPackageSubnavButton(pkg, count));
      panelsRoot.appendChild(createPackagePanelSection(pkg, count));
    });

    subnav.hidden = !packagesAccordionOpen;

    const activePanel = document.querySelector(".mentor-panel-view.is-active")?.dataset.mentorPanelView;
    if (activePanel?.startsWith("paket-")) {
      const studentPanel = parsePackageStudentPanel(activePanel);
      if (studentPanel) {
        const pkgExists = pageData.packages.some(
          (pkg) => sanitizeItemId(pkg.id) === studentPanel.packageId,
        );
        if (!pkgExists) showPanel("ogrenciler");
        else {
          ensurePackageStudentPanel({
            packageId: studentPanel.packageId,
            studentId: studentPanel.studentId,
            displayName: "Öğrenci",
          });
          void mountPackageStudentView(studentPanel.packageId, studentPanel.studentId);
        }
      } else {
        const pkgId = parsePackageIdFromPanel(activePanel);
        const stillExists = pageData.packages.some((pkg) => sanitizeItemId(pkg.id) === pkgId);
        if (!stillExists) showPanel("ogrenciler");
        else void mountPackagePanelView(pkgId);
      }
    }
  }

  async function resolveInitialPanelIdAsync() {
    const hashPanel = window.location.hash.replace("#", "");
    if (isKnownPanelId(hashPanel)) {
      return hashPanel;
    }

    const deepLink = window.RekabetliMentorMessaging?.parseInboxDeepLink?.();
    if (deepLink?.conversationId || deepLink?.inbox === "messages") {
      return "ogrenciler";
    }

    if (deepLink?.requestId && currentUser) {
      const { data } = await supabase
        .from("package_requests")
        .select("package_id")
        .eq("id", deepLink.requestId)
        .eq("mentor_id", currentUser.id)
        .maybeSingle();
      const pkgId = data?.package_id ? sanitizeItemId(data.package_id) : "";
      if (pkgId && pageData.packages.some((pkg) => sanitizeItemId(pkg.id) === pkgId)) {
        return packagePanelId(pkgId);
      }
      return "ogrenciler";
    }

    if (deepLink?.inbox === "requests") {
      return "ogrenciler";
    }

    const scheduleLink = await resolveScheduleDeepLink();
    if (scheduleLink) {
      pendingScheduleDeepLink = scheduleLink;
      return packageStudentPanelId(scheduleLink.packageId, scheduleLink.studentId);
    }

    return "sayfam";
  }

  function initMentorPanelNav() {
    const nav = document.querySelector(".mentor-panel-nav");
    if (!nav) return;

    async function refreshDisplayNameFromProfile() {
      if (!currentUser) return;
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", currentUser.id)
        .maybeSingle();
      if (data?.display_name?.trim()) {
        displayName = data.display_name.trim();
        if (displayNameEl) displayNameEl.textContent = displayName;
      }
    }

    showPanel = async function showPanelImpl(panelId, { updateHash = true } = {}) {
      const resolvedId = isKnownPanelId(panelId) ? panelId : "sayfam";
      const packageStudent = parsePackageStudentPanel(resolvedId);
      const isPackagePanel = resolvedId.startsWith("paket-");

      document.querySelectorAll("[data-mentor-panel]").forEach((btn) => {
        const isActive = btn.dataset.mentorPanel === resolvedId;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-current", isActive ? "page" : "false");
      });

      document.querySelectorAll(".mentor-panel-nav-btn--sub").forEach((btn) => {
        const btnPkgId = parsePackageIdFromPanel(btn.dataset.mentorPanel);
        const activePkgId = packageStudent?.packageId || parsePackageIdFromPanel(resolvedId);
        const isDirectPackage =
          isPackagePanel && !packageStudent && btn.dataset.mentorPanel === resolvedId;
        const isParentStudent = Boolean(packageStudent && btnPkgId === packageStudent.packageId);
        btn.classList.toggle("is-active", isDirectPackage);
        btn.classList.toggle("is-active-child", isParentStudent);
        btn.setAttribute(
          "aria-current",
          isDirectPackage || isParentStudent ? "page" : "false",
        );
      });

      const navGroup = document.querySelector('[data-mentor-nav-group="ogrenciler"]');
      if (navGroup) {
        const parentBtn = navGroup.querySelector('[data-mentor-panel="ogrenciler"]');
        parentBtn?.classList.toggle("is-active", resolvedId === "ogrenciler");
        parentBtn?.classList.toggle(
          "is-active-group",
          resolvedId === "ogrenciler" || isPackagePanel,
        );
        navGroup.classList.toggle("has-active-child", isPackagePanel);
      }

      document.querySelectorAll("[data-mentor-panel-view]").forEach((view) => {
        const isActive = view.dataset.mentorPanelView === resolvedId;
        view.hidden = !isActive;
        view.classList.toggle("is-active", isActive);
      });

      if (updateHash) {
        const nextHash = `#${resolvedId}`;
        if (window.location.hash !== nextHash) {
          history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}${nextHash}`,
          );
        }
      }

      if (resolvedId === "sayfam") {
        void refreshDisplayNameFromProfile();
      } else {
        exitPreviewMode();
      }

      if (resolvedId === "ogrenciler" || isPackagePanel) {
        setPackagesAccordionOpen(true);
      }

      if (resolvedId === "ogrenciler") {
        void mountMentorInbox();
        void loadLinkedStudents();
        void loadMentorReferralProgram();
        renderMeetingLinkForm();
      } else if (resolvedId === "cuzdanim") {
        renderPayoutForm();
        void loadMentorWallet();
      } else {
        payoutAccordionPinnedOpen = false;
      }

      if (packageStudent) {
        ensurePackageStudentPanel({
          packageId: packageStudent.packageId,
          studentId: packageStudent.studentId,
          displayName: "Öğrenci",
        });
        void mountPackageStudentView(packageStudent.packageId, packageStudent.studentId)
          .catch((error) => {
            console.error("package student panel:", error?.message || error);
          });
      } else if (isPackagePanel) {
        void mountPackagePanelView(parsePackageIdFromPanel(resolvedId))
          .catch((error) => {
            console.error("package panel:", error?.message || error);
          });
      }
    };

    nav.addEventListener("click", (event) => {
      const accordionToggle = event.target.closest("[data-mentor-accordion-toggle]");
      if (accordionToggle && nav.contains(accordionToggle)) {
        setPackagesAccordionOpen(!packagesAccordionOpen);
        return;
      }

      const btn = event.target.closest("[data-mentor-panel]");
      if (!btn || !nav.contains(btn)) return;
      showPanel(btn.dataset.mentorPanel);
    });

    document.querySelectorAll("[data-open-mentor-panel]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.preventDefault();
        showPanel(el.dataset.openMentorPanel);
      });
    });

    window.addEventListener("hashchange", () => {
      const hashPanel = window.location.hash.replace("#", "");
      if (isKnownPanelId(hashPanel)) showPanel(hashPanel, { updateHash: false });
    });

    if (window.location.hash.replace("#", "") === "profil") {
      void showPanel("profil", { updateHash: false });
    }
  }

  initMentorPanelNav();
  initMentorStudentInvite();
  initMentorMeetingLink();
  initVitrinReviewPanel();
  initMentorPayoutAccount();
  initMentorWallet();

  async function boot() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      window.location.href = `/login?redirect=${encodeURIComponent("/mentor-sayfam")}`;
      return;
    }

    currentUser = session.user;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("display_name, is_mentor, user_type")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (profileError) {
      console.error("mentor-sayfam profile:", profileError.message);
      setStatus("Profil yüklenemedi.");
      return;
    }

    const canManageMentorPage =
      Boolean(profile?.is_mentor) ||
      String(profile?.user_type || "").trim().toLowerCase() === "mentor";

    if (!canManageMentorPage) {
      window.location.replace("/ogrenci-sayfam");
      return;
    }

    displayName = profile.display_name?.trim() || "Mentör";

    try {
      await loadMentorPage(currentUser.id);
    } catch (error) {
      setStatus(error.message || "Mentör sayfası yüklenemedi.");
      return;
    }

    if (statusEl) statusEl.hidden = true;
    if (showcaseEl) showcaseEl.hidden = false;
    if (toolbarEl) toolbarEl.hidden = false;
    renderAll();
    await renderPackageNavAndPanels();

    const initialPanel = await resolveInitialPanelIdAsync();
    await showPanel(initialPanel, {
      updateHash: initialPanel !== "sayfam" || Boolean(window.location.hash),
    });
    renderMeetingLinkForm();
    renderPayoutForm();
  }

  void boot();
})();
