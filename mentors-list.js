(function initMentorsList() {
  const supabase = window.getSupabase?.() || window.sb;
  const gridEl = document.getElementById("mentors-preview-grid");
  const statusEl = document.getElementById("mentors-preview-status");
  const emptyEl = document.getElementById("mentors-preview-empty");
  const vitrin = window.RekabetliMentorVitrin;

  if (!supabase || !gridEl || !vitrin) return;

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

  async function loadMentors() {
    setStatus("Mentörler yükleniyor…");
    if (emptyEl) emptyEl.hidden = true;

    const { data: pages, error: pagesError } = await supabase
      .from("mentor_pages")
      .select(
        "user_id, photo_url, vitrin_accent, about, branches, private_lessons, packages, meeting_platform, meeting_link, payout_ready, updated_at, vitrin_review_status",
      )
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
      if (emptyEl) emptyEl.hidden = false;
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
    const rows = pageRows
      .map((page) => ({
        ...page,
        profiles: profileById.get(page.user_id) ?? null,
      }))
      .filter(vitrin.isListableMentorPage);
    gridEl.replaceChildren();

    if (!rows.length) {
      setStatus("");
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    rows.forEach((row) => {
      gridEl.appendChild(createPreviewCard(row));
    });
    setStatus("");
  }

  void loadMentors();
})();
