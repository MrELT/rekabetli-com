(function initMentorsList() {
  const supabase = window.getSupabase?.() || window.sb;
  const gridEl = document.getElementById("mentors-preview-grid");
  const statusEl = document.getElementById("mentors-preview-status");
  const emptyEl = document.getElementById("mentors-preview-empty");
  const categoryBarEl = document.getElementById("mentors-category-bar");
  const vitrin = window.RekabetliMentorVitrin;

  if (!supabase || !gridEl || !vitrin) return;

  const CATEGORY_ALL = "tumu";
  const CATEGORY_OLYMPIAD = "olimpiyat";
  const CATEGORY_TEKNOFEST = "teknofest";
  const CATEGORY_YKS = "yks";
  const CATEGORY_LESSONS = "ozel-ders";
  const KNOWN_CATEGORIES = new Set([
    CATEGORY_ALL,
    CATEGORY_OLYMPIAD,
    CATEGORY_TEKNOFEST,
    CATEGORY_YKS,
    CATEGORY_LESSONS,
  ]);
  const CATEGORY_STORAGE_KEY = "rekabetli.mentors.category";
  const EMPTY_ALL =
    "Henüz yayınlanmış mentör profili yok. Mentörler vitrinlerini hazırlayıp onay aldıkça burada listelenecek.";
  const EMPTY_CATEGORY = "Bu kategoride yayınlanmış mentör yok.";

  let allRows = [];
  let activeCategory = CATEGORY_ALL;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function renderTitleList(label, items) {
    const kind = label === "Mentörlük" ? "branch" : "lesson";
    const wrap = document.createElement("div");
    wrap.className = `mentor-preview-topic mentor-preview-topic--${kind === "branch" ? "branches" : "lessons"}`;
    const heading = document.createElement("p");
    heading.className = "mentor-preview-topic-label";
    heading.textContent = label;
    wrap.appendChild(heading);
    const list = document.createElement("ul");
    list.className = "mentor-preview-topic-list mentor-summary-list";
    const rows = (items ?? []).filter((item) => String(item?.title || "").trim());
    const shown = rows.slice(0, 4);
    shown.forEach((item, index) => {
      list.appendChild(
        vitrin.createSummaryChip(
          item.title.trim(),
          kind,
          index,
          vitrin.resolveItemAccent(item, kind, index),
        ),
      );
    });
    if (rows.length > shown.length) {
      const more = document.createElement("li");
      more.className = "mentor-preview-more";
      more.textContent = `+${rows.length - shown.length} daha`;
      list.appendChild(more);
    }
    if (!shown.length) {
      const li = document.createElement("li");
      li.className = "mentor-preview-topic-empty";
      li.textContent = "—";
      list.appendChild(li);
    }
    wrap.appendChild(list);
    return wrap;
  }

  function createPreviewCard(row) {
    const page = vitrin.normalizePageRow(row);
    const href = vitrin.mentorPublicUrl(page.userId);
    const card = document.createElement("a");
    card.className = "mentor-preview-card mentor-preview-card--themed";
    card.href = href;
    card.dataset.accent = vitrin.resolveVitrinAccent(page.vitrinAccent);

    const media = document.createElement("div");
    media.className = "mentor-preview-media";

    const photoWrap = document.createElement("div");
    photoWrap.className = "mentor-preview-photo";
    if (page.photoUrl) {
      const img = document.createElement("img");
      img.alt = page.displayName;
      vitrin.setSafeImage(img, page.photoUrl);
      photoWrap.appendChild(img);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "mentor-preview-photo-fallback";
      fallback.textContent = vitrin.getInitials(page.displayName);
      photoWrap.appendChild(fallback);
    }
    media.appendChild(photoWrap);

    const body = document.createElement("div");
    body.className = "mentor-preview-body";

    const name = document.createElement("h3");
    name.className = "mentor-preview-name";
    name.textContent = page.displayName;

    const topics = document.createElement("div");
    topics.className = "mentor-preview-topics";
    topics.append(
      renderTitleList("Mentörlük", page.branches),
      renderTitleList("Özel Ders", page.lessons),
    );

    const about = document.createElement("p");
    about.className = "mentor-preview-about";
    about.textContent =
      vitrin.excerptText(page.about, 180) || "Profili inceleyerek branş, ders ve paket detaylarını görün.";

    const actions = document.createElement("div");
    actions.className = "mentor-preview-actions";

    const cta = document.createElement("span");
    cta.className = "mentor-preview-cta";
    cta.textContent = "Profili incele";
    actions.appendChild(cta);

    const lowestPrice = vitrin.getLowestPackagePrice(page.packages);
    const startingLabel = vitrin.formatStartingPriceLabel(lowestPrice);
    if (startingLabel) {
      const startingPrice = document.createElement("span");
      startingPrice.className = "mentor-preview-starting-price";
      startingPrice.textContent = startingLabel;
      actions.appendChild(startingPrice);
    }

    body.append(name, topics, about, actions);
    card.append(media, body);
    return card;
  }

  function foldCategoryText(value) {
    return String(value || "")
      .toLocaleLowerCase("tr")
      .replace(/ı/g, "i")
      .replace(/ş/g, "s")
      .replace(/ğ/g, "g")
      .replace(/ü/g, "u")
      .replace(/ö/g, "o")
      .replace(/ç/g, "c");
  }

  function pageHasLessons(row) {
    const page = vitrin.normalizePageRow(row);
    return Boolean((vitrin.itemTitles?.(page.lessons) || []).length);
  }

  function pageSearchText(row) {
    const page = vitrin.normalizePageRow(row);
    const titles = [
      ...(vitrin.itemTitles?.(page.branches) || []),
      ...(vitrin.itemTitles?.(page.lessons) || []),
    ];
    return foldCategoryText(titles.join(" "));
  }

  function pageMatchesCategory(row, categoryKey) {
    if (categoryKey === CATEGORY_ALL) return true;
    if (categoryKey === CATEGORY_LESSONS) return pageHasLessons(row);
    const text = pageSearchText(row);
    if (categoryKey === CATEGORY_OLYMPIAD) {
      return /olimpiyat|olympiad|\bimo\b|\bipho\b|\bicho\b|\bibo\b|\bioi\b|tubitak/.test(text);
    }
    if (categoryKey === CATEGORY_TEKNOFEST) {
      return /teknofest|tekno\s*fest/.test(text);
    }
    if (categoryKey === CATEGORY_YKS) {
      return /\byks\b|\btyt\b|\bayt\b|\bydt\b/.test(text);
    }
    return false;
  }

  function readStoredCategory() {
    try {
      const raw = localStorage.getItem(CATEGORY_STORAGE_KEY);
      if (raw === "karisik") return CATEGORY_ALL;
      return raw ? String(raw) : "";
    } catch {
      return "";
    }
  }

  function storeCategory(key) {
    try {
      localStorage.setItem(CATEGORY_STORAGE_KEY, key);
    } catch {
      /* ignore quota / private mode */
    }
  }

  function randomUnit() {
    const bytes = new Uint32Array(1);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return bytes[0] / 4294967296;
    }
    return Math.random();
  }

  function shuffleRows(rows) {
    const arr = rows.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(randomUnit() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function rowsForCategory(categoryKey) {
    if (categoryKey === CATEGORY_ALL) return shuffleRows(allRows);
    return allRows.filter((row) => pageMatchesCategory(row, categoryKey));
  }

  function syncCategoryButtons() {
    if (!categoryBarEl) return;
    [...categoryBarEl.querySelectorAll("[data-mentor-category]")].forEach((node) => {
      const on = node.dataset.mentorCategory === activeCategory;
      node.classList.toggle("is-active", on);
      node.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function bindCategoryBar() {
    if (!categoryBarEl) return;
    categoryBarEl.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-mentor-category]");
      if (!btn || !categoryBarEl.contains(btn)) return;
      const next = btn.dataset.mentorCategory || CATEGORY_ALL;
      if (!KNOWN_CATEGORIES.has(next)) return;
      if (next === activeCategory && next !== CATEGORY_ALL) return;
      activeCategory = next;
      storeCategory(activeCategory);
      syncCategoryButtons();
      renderVisibleMentors();
    });
  }

  function renderVisibleMentors() {
    const visible = rowsForCategory(activeCategory);
    gridEl.replaceChildren();
    if (!visible.length) {
      if (emptyEl) {
        emptyEl.textContent = allRows.length ? EMPTY_CATEGORY : EMPTY_ALL;
        emptyEl.hidden = false;
      }
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    visible.forEach((row) => {
      gridEl.appendChild(createPreviewCard(row));
    });
  }

  async function loadMentors() {
    setStatus("Mentörler yükleniyor…");
    if (emptyEl) emptyEl.hidden = true;

    const { data: pages, error: pagesError } = await supabase
      .from("mentor_pages")
      .select(
        "user_id, photo_url, vitrin_accent, about, branches, private_lessons, packages, meeting_platform, meeting_link, payout_ready, updated_at, vitrin_review_status",
      )
      .eq("vitrin_review_status", "approved")
      .order("updated_at", { ascending: false })
      .limit(60);

    if (pagesError) {
      console.error("mentors list:", pagesError.message);
      setStatus("Mentör listesi yüklenemedi.");
      return;
    }

    const pageRows = pages ?? [];
    if (!pageRows.length) {
      setStatus("");
      if (emptyEl) {
        emptyEl.textContent = EMPTY_ALL;
        emptyEl.hidden = false;
      }
      return;
    }

    const userIds = pageRows.map((row) => row.user_id);
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, display_name, is_mentor, avatar_url")
      .in("id", userIds)
      .eq("is_mentor", true);

    if (profilesError) {
      console.error("mentors profiles:", profilesError.message);
      setStatus("Mentör listesi yüklenemedi.");
      return;
    }

    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    allRows = pageRows
      .map((page) => ({
        ...page,
        profiles: profileById.get(page.user_id) ?? null,
      }))
      .filter(vitrin.isListableMentorPage);

    if (!allRows.length) {
      setStatus("");
      if (emptyEl) {
        emptyEl.textContent = EMPTY_ALL;
        emptyEl.hidden = false;
      }
      return;
    }

    const stored = readStoredCategory();
    activeCategory = KNOWN_CATEGORIES.has(stored) ? stored : CATEGORY_ALL;
    storeCategory(activeCategory);
    syncCategoryButtons();
    renderVisibleMentors();
    setStatus("");
  }

  bindCategoryBar();
  void loadMentors();
})();
