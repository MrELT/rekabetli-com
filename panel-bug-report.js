(function initPanelBugReport() {
  const RPC_NAME = "submit_panel_error_report";

  const ERROR_MESSAGES = {
    auth_required: "Giriş yapmalısınız.",
    panel_error_invalid_role: "Geçersiz panel türü.",
    panel_error_description_too_short: "Hata açıklaması en az 10 karakter olmalıdır.",
    panel_error_description_too_long: "Hata açıklaması çok uzun.",
    panel_error_rate_limited: "Çok fazla bildirim gönderdiniz. Lütfen bir süre sonra tekrar deneyin.",
  };

  function getSupabase() {
    return window.getSupabase?.() || window.sb || null;
  }

  function sanitizeCode(value) {
    const sec = window.RekabetliSecurity;
    const text = sec?.sanitizePlainText?.(value, 120) || String(value || "").trim().slice(0, 120);
    return text || null;
  }

  function sanitizeDescription(value) {
    const sec = window.RekabetliSecurity;
    return sec?.sanitizeMultilinePlainText?.(value, 2000) || String(value || "").trim().slice(0, 2000);
  }

  function mapRpcError(message) {
    const raw = String(message || "");
    for (const [code, label] of Object.entries(ERROR_MESSAGES)) {
      if (raw.includes(code)) return label;
    }
    return "Bildirim gönderilemedi. Lütfen tekrar deneyin.";
  }

  function setMessage(el, text, isError = false) {
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("empty", !text);
    el.classList.toggle("profile-message-error", Boolean(isError && text));
  }

  function bindForm(form) {
    const role = String(form.dataset.bugReportRole || "").trim();
    const messageEl = document.getElementById(form.dataset.messageTarget || "");
    const codeInput = form.querySelector("[name='error_code']");
    const descInput = form.querySelector("[name='description']");
    const submitBtn = form.querySelector('[type="submit"]');

    if (!role || !descInput) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const supabase = getSupabase();
      if (!supabase) {
        setMessage(messageEl, "Bağlantı kurulamadı. Sayfayı yenileyip tekrar deneyin.", true);
        return;
      }

      const description = sanitizeDescription(descInput.value);
      if (description.length < 10) {
        setMessage(messageEl, ERROR_MESSAGES.panel_error_description_too_short, true);
        descInput.focus();
        return;
      }

      const errorCode = sanitizeCode(codeInput?.value || "");
      const pageUrl = String(window.location.href || "").slice(0, 500);

      if (submitBtn) submitBtn.disabled = true;
      setMessage(messageEl, "Gönderiliyor…");

      try {
        const { data, error } = await supabase.rpc(RPC_NAME, {
          p_panel_role: role,
          p_error_code: errorCode,
          p_description: description,
          p_page_url: pageUrl,
        });

        if (error) throw error;
        if (!data) throw new Error("empty_response");

        form.reset();
        setMessage(
          messageEl,
          "Teşekkürler! Hata bildiriminiz alındı. En kısa sürede inceleyeceğiz.",
          false,
        );
      } catch (err) {
        console.error("panel bug report:", err);
        setMessage(messageEl, mapRpcError(err?.message), true);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  document.querySelectorAll("[data-bug-report-form]").forEach(bindForm);
})();
