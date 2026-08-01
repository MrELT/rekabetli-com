(function initHomeMentorsRail() {
  const supabase = window.getSupabase?.() || window.sb;
  const vitrin = window.RekabetliMentorVitrin;
  const sectionEl = document.getElementById("home-mentors-rail");
  const trackEl = document.getElementById("home-mentors-track");
  const viewportEl = sectionEl?.querySelector(".home-mentors-rail-viewport");

  if (!supabase || !vitrin || !sectionEl || !trackEl) return;

  const MIN_TRACK_COPIES = 2;
  const TARGET_CARD_COUNT = 12;

  function topicTitles(page) {
    const branches = vitrin.itemTitles?.(page.branches) ?? [];
    const lessons = vitrin.itemTitles?.(page.lessons) ?? [];
    return [...branches, ...lessons].filter(Boolean).slice(0, 2);
  }

  function createRailCard(row) {
    const page = vitrin.normalizePageRow(row);
    const href = vitrin.mentorPublicUrl(page.userId);
    const card = document.createElement("a");
    card.className = "home-mentor-card";
    card.href = href;
    card.dataset.accent = vitrin.resolveVitrinAccent(page.vitrinAccent);
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-label", `${page.displayName} mentör profili`);

    const photo = document.createElement("div");
    photo.className = "home-mentor-card-photo";
    if (page.photoUrl) {
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      vitrin.setSafeImage(img, page.photoUrl);
      photo.appendChild(img);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "home-mentor-card-fallback";
      fallback.textContent = vitrin.getInitials(page.displayName);
      photo.appendChild(fallback);
    }

    const body = document.createElement("div");
    body.className = "home-mentor-card-body";

    const name = document.createElement("h3");
    name.className = "home-mentor-card-name";
    name.textContent = page.displayName;

    const topics = topicTitles(page);
    if (topics.length) {
      const meta = document.createElement("p");
      meta.className = "home-mentor-card-topics";
      meta.textContent = topics.join(" · ");
      body.append(name, meta);
    } else {
      body.appendChild(name);
    }

    const cta = document.createElement("span");
    cta.className = "home-mentor-card-cta";
    cta.textContent = "Profili incele";
    body.appendChild(cta);

    card.append(photo, body);
    return card;
  }

  function buildTrack(rows) {
    trackEl.replaceChildren();
    trackEl.classList.remove("is-animating");

    let copies = MIN_TRACK_COPIES;
    while (rows.length * copies < TARGET_CARD_COUNT) {
      copies += 1;
    }

    for (let i = 0; i < copies; i += 1) {
      rows.forEach((row) => {
        const card = createRailCard(row);
        if (i > 0) {
          card.setAttribute("aria-hidden", "true");
          card.tabIndex = -1;
        }
        trackEl.appendChild(card);
      });
    }

    trackEl.style.setProperty("--home-mentors-copies", String(copies));
    const durationSec = Math.max(28, Math.min(72, rows.length * copies * 3.2));
    trackEl.style.setProperty("--home-mentors-duration", `${durationSec}s`);

    requestAnimationFrame(() => {
      trackEl.classList.add("is-animating");
    });
  }

  function bindPauseInteractions() {
    if (!viewportEl) return;

    const pause = () => trackEl.classList.add("is-paused");
    const resume = () => trackEl.classList.remove("is-paused");

    viewportEl.addEventListener("pointerenter", pause);
    viewportEl.addEventListener("pointerleave", resume);
    viewportEl.addEventListener("focusin", pause);
    viewportEl.addEventListener("focusout", (event) => {
      if (!viewportEl.contains(event.relatedTarget)) resume();
    });
  }

  async function loadMentors() {
    const { data: pages, error: pagesError } = await supabase
      .from("mentor_pages")
      .select(
        "user_id, photo_url, vitrin_accent, about, branches, private_lessons, packages, meeting_platform, meeting_link, payout_ready, updated_at, vitrin_review_status",
      )
      .eq("vitrin_review_status", "approved")
      .order("updated_at", { ascending: false })
      .limit(24);

    if (pagesError) {
      console.error("home mentors rail:", pagesError.message);
      return;
    }

    const pageRows = pages ?? [];
    if (!pageRows.length) return;

    const userIds = pageRows.map((row) => row.user_id);
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, display_name, is_mentor, avatar_url")
      .in("id", userIds)
      .eq("is_mentor", true);

    if (profilesError) {
      console.error("home mentors rail profiles:", profilesError.message);
      return;
    }

    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const rows = pageRows
      .map((page) => ({
        ...page,
        profiles: profileById.get(page.user_id) ?? null,
      }))
      .filter(vitrin.isListableMentorPage);

    if (!rows.length) return;

    buildTrack(rows);
    sectionEl.hidden = false;
    bindPauseInteractions();
  }

  void loadMentors();
})();
