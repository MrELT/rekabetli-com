(function initInfluencerProgramPage() {
  const supabase = window.getSupabase?.() || window.sb;
  if (!supabase) {
    console.error("[rekabetli] Supabase yüklenemedi. Sayfayı yenileyin.");
    return;
  }

  const form = document.getElementById("influencer-application-form");
  const loginHint = document.getElementById("influencer-application-login-hint");
  const statusEl = document.getElementById("influencer-application-status");
  const messageEl = document.getElementById("influencer-application-message");
  const applicationCard = document.querySelector(".influencer-application-card");

  function setLoading(isLoading) {
    applicationCard?.classList.toggle("is-loading", isLoading);
  }

  function showLoggedOutState() {
    if (form) form.hidden = true;
    if (loginHint) loginHint.hidden = false;
    if (statusEl) statusEl.hidden = true;
    setMessage("");
  }

  function showApplicationForm(data) {
    if (loginHint) loginHint.hidden = true;
    if (form) form.hidden = false;
    fillForm(data);
  }

  function setMessage(text, isError = false) {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.classList.toggle("empty", !text);
    messageEl.classList.toggle("profile-message-error", Boolean(isError && text));
  }

  function formatStatus(status) {
    const map = {
      none: "",
      pending: "Başvurunuz alındı ve inceleniyor. Onay sonrası e-posta ile bilgilendirileceksiniz.",
      approved: "Başvurunuz onaylandı! Influencer panelinize gidebilirsiniz.",
      rejected: "Başvurunuz şu an için uygun bulunmadı. Sorularınız için iletişim sayfamızdan bize ulaşabilirsiniz.",
    };
    return map[status] || "";
  }

  function applyStatusStyle(el, status) {
    if (!el) return;
    el.classList.remove("is-pending", "is-rejected");
    if (status === "pending") el.classList.add("is-pending");
    if (status === "rejected") el.classList.add("is-rejected");
  }

  function fillForm(data) {
    document.getElementById("influencer-display-label").value = data?.display_label || data?.display_name || "";
    document.getElementById("influencer-social-platform").value = data?.social_platform || "";
    document.getElementById("influencer-social-handle").value = data?.social_handle || "";
    document.getElementById("influencer-follower-range").value = data?.follower_range || "";
    document.getElementById("influencer-contact-email").value = data?.contact_email || "";
    document.getElementById("influencer-website-url").value = data?.website_url || "";
    document.getElementById("influencer-application-note").value = data?.application_note || "";
  }

  async function loadApplicationState(user) {
    if (!user) {
      showLoggedOutState();
      return;
    }

    setLoading(true);
    setMessage("");
    if (loginHint) loginHint.hidden = true;

    try {
      const { data, error } = await supabase.rpc("get_my_influencer_application");
      if (error) {
        console.error("get_my_influencer_application:", error.message);
        showApplicationForm({ display_name: user.user_metadata?.full_name || user.email || "" });
        setMessage("Başvuru bilgileri yüklenemedi. Formu doldurup gönderebilirsiniz.", true);
        return;
      }

      const status = data?.status || "none";
      const statusText = formatStatus(status);

      if (statusEl) {
        statusEl.replaceChildren();
        statusEl.hidden = !statusText;
        statusEl.textContent = statusText;
        applyStatusStyle(statusEl, status);
      }

      if (status === "approved") {
        if (form) form.hidden = true;
        if (loginHint) loginHint.hidden = true;
        if (statusEl && statusText) {
          const panelLink = document.createElement("a");
          panelLink.href = "/influencer-sayfam";
          panelLink.className = "nav-btn nav-btn-primary";
          panelLink.style.marginTop = "0.75rem";
          panelLink.style.display = "inline-flex";
          panelLink.textContent = "Influencer Panelime Git";
          statusEl.append(document.createElement("br"), panelLink);
        }
        return;
      }

      if (status === "rejected") {
        if (form) form.hidden = true;
        if (loginHint) loginHint.hidden = true;
        return;
      }

      showApplicationForm(data);

      if (status === "pending") {
        const submitBtn = document.getElementById("influencer-application-submit");
        if (submitBtn) submitBtn.textContent = "Başvuruyu güncelle";
      } else {
        const submitBtn = document.getElementById("influencer-application-submit");
        if (submitBtn) submitBtn.textContent = "Başvuruyu gönder";
      }
    } catch (err) {
      console.error("loadApplicationState:", err);
      showApplicationForm({ display_name: user.user_metadata?.full_name || user.email || "" });
      setMessage("Başvuru formu yüklenirken bir hata oluştu. Tekrar deneyebilirsiniz.", true);
    } finally {
      setLoading(false);
    }
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");

    const submitBtn = document.getElementById("influencer-application-submit");
    if (submitBtn) submitBtn.disabled = true;

    const { data, error } = await supabase.rpc("submit_influencer_application", {
      p_display_label: document.getElementById("influencer-display-label")?.value?.trim() || "",
      p_social_platform: document.getElementById("influencer-social-platform")?.value?.trim() || "",
      p_social_handle: document.getElementById("influencer-social-handle")?.value?.trim() || "",
      p_follower_range: document.getElementById("influencer-follower-range")?.value?.trim() || "",
      p_application_note: document.getElementById("influencer-application-note")?.value?.trim() || "",
      p_contact_email: document.getElementById("influencer-contact-email")?.value?.trim() || "",
      p_website_url: document.getElementById("influencer-website-url")?.value?.trim() || "",
    });

    if (submitBtn) submitBtn.disabled = false;

    if (error) {
      const msg = error.message || "";
      const friendly = msg.includes("influencer_already_approved")
        ? "Zaten onaylı influencersınız. Panelinize gidebilirsiniz."
        : msg.includes("influencer_application_rejected")
          ? "Önceki başvurunuz reddedildi."
          : `Başvuru gönderilemedi: ${msg}`;
      setMessage(friendly, true);
      return;
    }

    setMessage("Başvurunuz alındı. İnceleme sonrası bilgilendirileceksiniz.");
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    await loadApplicationState(currentUser);
    void data;
  });

  async function bootstrapAuth() {
    if (window.RekabetliAuth?.subscribe) {
      window.RekabetliAuth.subscribe((authState) => {
        if (!authState.ready) return;
        void loadApplicationState(authState.user);
      });
      return;
    }

    const { data } = await supabase.auth.getSession();
    await loadApplicationState(data.session?.user ?? null);
  }

  void bootstrapAuth();
})();
