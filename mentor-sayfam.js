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
  const packagesListEl = document.getElementById("mentor-packages-list");
  const addPackageBtn = document.getElementById("mentor-add-package");
  const toolbarEl = document.getElementById("mentor-sayfam-toolbar");
  const previewToggleBtn = document.getElementById("mentor-preview-toggle-btn");
  const toolbarLabelEl = document.getElementById("mentor-sayfam-toolbar-label");

  const MAX_ITEMS = 12;
  const MAX_TITLE = 120;
  const MAX_DESC = 800;
  const MAX_PACKAGE_CONTENT = 1200;
  const PRICE_INFO_TEXT =
    "Girdiğiniz liste fiyatından platform komisyonu ve KDV düşülür. Hesabınıza yatan net tutar bu kesintiler sonrası belirlenir.";

  let currentUser = null;
  let displayName = "Mentör";
  let pageData = {
    photo_url: null,
    vitrin_accent: null,
    about: null,
    branches: [],
    private_lessons: [],
    packages: [],
  };
  let saving = false;
  let previewMode = false;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setMessage(text, isError = false) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.classList.toggle("empty", !text);
    messageEl.classList.toggle("profile-message-error", Boolean(isError));
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
    };

    card.querySelectorAll(".mentor-item-title, .mentor-item-desc, .mentor-item-price, .mentor-item-capacity").forEach((el) => {
      el.addEventListener("input", markDirtyIfChanged);
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
    card.appendChild(actions);

    saveBtn.addEventListener("click", () => {
      void saveItemFromCard(kind, card);
    });

    deleteBtn.addEventListener("click", () => {
      void deleteItem(kind, item.id);
    });

    bindCardSaveButton(card, kind);
    return card;
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

    actions.append(saveBtn, deleteBtn);

    const vitrin = window.RekabetliMentorVitrin;
    card.append(titleLabel, titleInput, contentLabel, contentInput, metaRow);
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
    card.appendChild(actions);

    saveBtn.addEventListener("click", () => {
      void savePackageFromCard(card);
    });

    deleteBtn.addEventListener("click", () => {
      void deletePackage(item.id);
    });

    bindCardSaveButton(card, "package");
    return card;
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
    const accent = vitrin?.readAccentFromField?.(card) || null;
    return { title, content, price, capacity, accent };
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
        const empty = document.createElement("p");
        empty.className = "mentor-items-empty";
        empty.textContent = "Henüz branş eklemediniz.";
        branchesListEl.appendChild(empty);
      } else {
        pageData.branches.forEach((item, index) => {
          branchesListEl.appendChild(createItemCard(item, "branch", index));
        });
      }
    }

    if (lessonsListEl) {
      lessonsListEl.replaceChildren();
      if (!pageData.private_lessons.length) {
        const empty = document.createElement("p");
        empty.className = "mentor-items-empty";
        empty.textContent = "Henüz özel ders eklemediniz.";
        lessonsListEl.appendChild(empty);
      } else {
        pageData.private_lessons.forEach((item, index) => {
          lessonsListEl.appendChild(createItemCard(item, "lesson", index));
        });
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
        const empty = document.createElement("p");
        empty.className = "mentor-items-empty";
        empty.textContent = "Henüz paket eklemediniz.";
        packagesListEl.appendChild(empty);
      } else {
        pageData.packages.forEach((item, index) => {
          packagesListEl.appendChild(createPackageCard(item, index));
        });
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
      setMessage(markupError, true);
      return;
    }
    if (!title) {
      setMessage(kind === "branch" ? "Branş başlığı gerekli." : "Ders adı gerekli.", true);
      return;
    }

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
    renderItemEditors();
    renderSummaries();

    const listEl = kind === "branch" ? branchesListEl : lessonsListEl;
    const card = listEl?.querySelector(`[data-item-id="${item.id}"]`);
    card?.querySelector(".mentor-item-title")?.focus();
  }

  async function savePackageFromCard(card) {
    const itemId = card.dataset.itemId;
    const saveBtn = card.querySelector(".mentor-item-save");
    const { title, content, price, capacity, accent } = readPackageFromCard(card);
    const markupError = rejectMarkupInRawFields(
      card.querySelector(".mentor-item-title")?.value,
      card.querySelector(".mentor-item-desc")?.value,
      card.querySelector(".mentor-item-price")?.value,
      card.querySelector(".mentor-item-capacity")?.value,
    );
    if (markupError) {
      setMessage(markupError, true);
      return;
    }
    if (!title) {
      setMessage("Paket başlığı gerekli.", true);
      return;
    }
    if (price == null && card.querySelector(".mentor-item-price")?.value?.trim()) {
      setMessage("Geçerli bir fiyat girin.", true);
      return;
    }
    const capacityRaw = card.querySelector(".mentor-item-capacity")?.value?.trim();
    if (capacityRaw && capacity == null) {
      setMessage("Kapasite 1–9999 arasında tam sayı olmalı.", true);
      return;
    }

    const items = [...pageData.packages];
    const index = items.findIndex((item) => item.id === itemId);
    const next = { id: itemId, title, content, price, capacity, accent };
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
      accent: vitrin?.getAccentForKind?.("package", index) || null,
    };
    pageData.packages = [...pageData.packages, item];
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

  async function renderVitrinDisplays() {
    const vitrin = window.RekabetliMentorVitrin;
    if (!vitrin) return;
    vitrin.renderVitrinBranches(
      document.getElementById("mentor-vitrin-branches"),
      pageData.branches,
      "Henüz branş eklemediniz.",
    );
    vitrin.renderVitrinLessons(
      document.getElementById("mentor-vitrin-lessons"),
      pageData.private_lessons,
      "Henüz özel ders eklemediniz.",
    );
    const fillCounts = currentUser?.id
      ? await vitrin.fetchPackageFillCounts(supabase, currentUser.id)
      : new Map();
    vitrin.renderVitrinPackages(
      document.getElementById("mentor-vitrin-packages"),
      pageData.packages,
      "Henüz paket eklemediniz.",
      {
        mentorId: currentUser?.id || null,
        mentorName: displayName,
        packageFillCounts: fillCounts,
      },
    );
  }

  function renderAll() {
    if (previewMode) return;
    if (displayNameEl) displayNameEl.textContent = displayName;
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
      const { title, content, price, capacity, accent } = readPackageFromCard(card);
      if (!title && !content) return;
      items.push({
        id: card.dataset.itemId,
        title,
        content,
        price,
        capacity,
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

  async function mountPackagePanelView(packageId) {
    const safeId = sanitizeItemId(packageId);
    const root = document.getElementById(`mentor-package-panel-root-${safeId}`);
    const pkg = pageData.packages.find((item) => sanitizeItemId(item.id) === safeId);
    if (!root || !pkg || !currentUser?.id || !window.RekabetliMentorMessaging?.mountPackagePanel) {
      return;
    }

    const countEl = document.getElementById(`mentor-package-student-count-${safeId}`);
    if (countEl) {
      const count = packageFillCounts.get(safeId) || 0;
      countEl.textContent = `${count} danışan / öğrenci`;
    }

    const deepLink = window.RekabetliMentorMessaging.parseInboxDeepLink?.() || null;
    await window.RekabetliMentorMessaging.mountPackagePanel({
      root,
      mentorId: currentUser.id,
      packageId: safeId,
      packageTitle: pkg.title,
      deepLink,
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
  }

  async function loadMentorPage(userId) {
    const { data, error } = await supabase
      .from("mentor_pages")
      .select("photo_url, vitrin_accent, about, branches, private_lessons, packages")
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
    };
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

  let packageFillCounts = new Map();
  let showPanel = () => {};
  let packagesAccordionOpen = false;

  function setPackagesAccordionOpen(open) {
    packagesAccordionOpen = open;
    const group = document.querySelector('[data-mentor-nav-group="ogrenciler"]');
    const parentBtn = document.querySelector('[data-mentor-accordion="ogrenciler"]');
    const subnav = document.getElementById("mentor-package-subnav");
    group?.classList.toggle("is-open", open);
    parentBtn?.setAttribute("aria-expanded", open ? "true" : "false");
    if (subnav) subnav.hidden = !open;
  }

  function packagePanelId(packageId) {
    return `paket-${sanitizeItemId(packageId)}`;
  }

  function parsePackageIdFromPanel(panelId) {
    const raw = String(panelId || "");
    if (!raw.startsWith("paket-")) return "";
    return sanitizeItemId(raw.slice(6));
  }

  function isKnownPanelId(panelId) {
    if (
      panelId === "profil" ||
      panelId === "sayfam" ||
      panelId === "ogrenciler" ||
      panelId === "cuzdanim"
    ) {
      return true;
    }
    return Boolean(parsePackageIdFromPanel(panelId));
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
    main.className = "mentor-panel-students-layout";

    const panel = document.createElement("section");
    panel.className = "panel auth-panel mentor-students-panel";

    const heading = document.createElement("h1");
    heading.textContent = title;

    const countEl = document.createElement("p");
    countEl.id = `mentor-package-student-count-${safeId}`;
    countEl.className = "mentor-package-student-count";
    countEl.textContent = `${count} danışan / öğrenci`;

    const hint = document.createElement("p");
    hint.className = "profile-hint mentor-package-panel-hint";
    hint.textContent =
      "Bu pakete bağlı öğrenciler yakında burada listelenecek. Şimdilik ön talepler aşağıda görünür.";

    const root = document.createElement("div");
    root.id = `mentor-package-panel-root-${safeId}`;
    root.className = "mentor-package-panel-root";

    panel.append(heading, countEl, hint, root);
    main.appendChild(panel);
    section.appendChild(main);
    return section;
  }

  async function renderPackageNavAndPanels() {
    const subnav = document.getElementById("mentor-package-subnav");
    const panelsRoot = document.getElementById("mentor-package-panels");
    if (!subnav || !panelsRoot) return;

    packageFillCounts = await loadPackageFillCounts();
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
      const count = packageFillCounts.get(safeId) || 0;
      subnav.appendChild(createPackageSubnavButton(pkg, count));
      panelsRoot.appendChild(createPackagePanelSection(pkg, count));
    });

    subnav.hidden = !packagesAccordionOpen;

    const activePanel = document.querySelector(".mentor-panel-view.is-active")?.dataset.mentorPanelView;
    if (activePanel?.startsWith("paket-")) {
      const pkgId = parsePackageIdFromPanel(activePanel);
      const stillExists = pageData.packages.some((pkg) => sanitizeItemId(pkg.id) === pkgId);
      if (!stillExists) showPanel("ogrenciler");
    }
  }

  async function resolveInitialPanelIdAsync() {
    const hashPanel = window.location.hash.replace("#", "");
    if (hashPanel === "profil" || hashPanel === "sayfam" || hashPanel === "ogrenciler" || hashPanel === "cuzdanim") {
      return hashPanel;
    }
    if (hashPanel.startsWith("paket-") && parsePackageIdFromPanel(hashPanel)) {
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

    showPanel = function showPanelImpl(panelId, { updateHash = true } = {}) {
      const resolvedId = isKnownPanelId(panelId) ? panelId : "sayfam";
      const isPackagePanel = resolvedId.startsWith("paket-");

      document.querySelectorAll("[data-mentor-panel]").forEach((btn) => {
        const isActive = btn.dataset.mentorPanel === resolvedId;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-current", isActive ? "page" : "false");
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
      } else if (isPackagePanel) {
        void mountPackagePanelView(parsePackageIdFromPanel(resolvedId));
      }
    };

    nav.addEventListener("click", (event) => {
      const accordionBtn = event.target.closest("[data-mentor-accordion]");
      if (accordionBtn && nav.contains(accordionBtn)) {
        const willOpen = !packagesAccordionOpen;
        setPackagesAccordionOpen(willOpen);
        if (willOpen) showPanel("ogrenciler");
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
  }

  initMentorPanelNav();

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
      .select("display_name, is_mentor")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (profileError) {
      console.error("mentor-sayfam profile:", profileError.message);
      setStatus("Profil yüklenemedi.");
      return;
    }

    if (!profile?.is_mentor) {
      window.location.replace("/profile");
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
    showPanel(initialPanel, {
      updateHash: initialPanel !== "sayfam" || Boolean(window.location.hash),
    });
  }

  void boot();
})();
