(function initMentorOnboarding() {
  const supabase = window.getSupabase?.() || window.sb;
  if (!supabase) return;

  const applyBtn = document.getElementById("mentor-apply-btn");
  const modal = document.getElementById("mentor-onboard-modal");
  const closeBtn = document.getElementById("close-mentor-onboard-modal");
  const dismissBtn = document.getElementById("mentor-onboard-dismiss");
  const goPanelBtn = document.getElementById("mentor-onboard-go-panel");
  const messageEl = document.getElementById("mentor-onboard-message");

  if (!applyBtn || !modal) return;

  const MENTOR_USER_TYPE = "Mentor";

  function setMessage(text, isError = false) {
    if (!messageEl) return;
    if (!text) {
      messageEl.hidden = true;
      messageEl.textContent = "";
      messageEl.classList.remove("is-error");
      return;
    }
    messageEl.hidden = false;
    messageEl.textContent = text;
    messageEl.classList.toggle("is-error", isError);
  }

  function openModal() {
    setMessage("");
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    closeBtn?.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    setMessage("");
  }

  function getOnboardReturnUrl() {
    const path = window.location.pathname.replace(/\/index\.html$/i, "") || "/";
    if (path === "/") return "/?openMentorOnboard=1";
    return "/kimler-icin?openMentorOnboard=1#mentorler";
  }

  function clearOnboardQuery() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("openMentorOnboard") && !params.has("openMentorApp")) return;
    params.delete("openMentorOnboard");
    params.delete("openMentorApp");
    const path = window.location.pathname.replace(/\/index\.html$/i, "") || "/";
    const hash = path === "/" ? "" : window.location.hash || "";
    const query = params.toString();
    const base = path === "/" ? "/" : path;
    window.history.replaceState({}, "", query ? `${base}?${query}${hash}` : `${base}${hash}`);
  }

  async function becomeMentor(sessionUser) {
    const { data: profile, error: loadError } = await supabase
      .from("profiles")
      .select("id, user_type, is_mentor, display_name, email, phone")
      .eq("id", sessionUser.id)
      .maybeSingle();

    if (loadError) throw loadError;

    const alreadyMentorType =
      String(profile?.user_type || "").trim().toLowerCase() === "mentor" || profile?.is_mentor;

    if (alreadyMentorType) {
      window.RekabetliPanelHome?.setPath?.(sessionUser.id, "/mentor-sayfam");
      void window.syncProfileNavState?.(sessionUser);
      return { already: true, profile };
    }

    const meta = sessionUser.user_metadata || {};
    const displayName =
      profile?.display_name?.trim() ||
      [meta.first_name, meta.last_name].filter(Boolean).join(" ").trim() ||
      sessionUser.email?.split("@")[0] ||
      "Mentör";

    const { error: saveError } = await supabase.from("profiles").upsert(
      {
        id: sessionUser.id,
        email: profile?.email || sessionUser.email || null,
        display_name: displayName,
        phone: profile?.phone || meta.phone || null,
        user_type: MENTOR_USER_TYPE,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (saveError) throw saveError;

    window.RekabetliPanelHome?.setPath?.(sessionUser.id, "/mentor-sayfam");
    void window.syncProfileNavState?.(sessionUser);

    return { already: false, profile };
  }

  async function handleApplyClick() {
    applyBtn.disabled = true;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = `/login?redirect=${encodeURIComponent(getOnboardReturnUrl())}`;
        return;
      }

      await becomeMentor(session.user);
      openModal();
    } catch (error) {
      console.error("mentor onboard:", error);
      const msg =
        error?.message ||
        "Mentör tipi ayarlanamadı. Lütfen tekrar deneyin veya profil sayfanızdan kullanıcı tipini Mentör olarak kaydedin.";
      if (typeof window.rekabetliAlert === "function") {
        await window.rekabetliAlert({
          title: "Mentör olamadı",
          message: msg,
          confirmLabel: "Tamam",
        });
      } else {
        window.alert(msg);
      }
    } finally {
      applyBtn.disabled = false;
    }
  }

  applyBtn.addEventListener("click", () => {
    void handleApplyClick();
  });

  closeBtn?.addEventListener("click", closeModal);
  dismissBtn?.addEventListener("click", closeModal);

  goPanelBtn?.addEventListener("click", () => {
    window.location.href = "/mentor-sayfam";
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get("openMentorOnboard") === "1" || params.get("openMentorApp") === "1") {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      void becomeMentor(data.session.user)
        .then(() => {
          openModal();
          clearOnboardQuery();
        })
        .catch((error) => {
          console.error("mentor onboard auto:", error);
          clearOnboardQuery();
        });
    });
  }
})();
