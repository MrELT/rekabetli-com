(function initForgotPassword() {
  const supabaseClient = window.getSupabase?.() || window.sb;
  const sec = window.RekabetliSecurity;
  const form = document.getElementById("forgot-password-form");
  const messageEl = document.getElementById("forgot-password-message");
  const submitBtn = document.getElementById("forgot-password-submit");

  function setMessage(text, isError = false) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.classList.toggle("profile-message-error", isError);
  }

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");

    if (!supabaseClient) {
      setMessage("Bağlantı hazırlanamadı. Lütfen sayfayı yenileyin.", true);
      return;
    }

    const data = new FormData(form);
    const rawEmail = String(data.get("email") || "");
    if (sec?.containsMarkupAttempt?.(rawEmail)) {
      setMessage("Geçerli bir e-posta adresi girin.", true);
      return;
    }

    const email = sec?.sanitizeEmail
      ? sec.sanitizeEmail(rawEmail, 120)
      : rawEmail.trim().toLowerCase();
    if (!email) {
      setMessage("E-posta adresini girin.", true);
      return;
    }
    if (sec?.isValidEmail && !sec.isValidEmail(email)) {
      setMessage("Geçerli bir e-posta adresi girin.", true);
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });

      if (error) {
        console.error("Password reset email error:", error.message);
        setMessage("Şifre yenileme e-postası gönderilemedi. Lütfen tekrar deneyin.", true);
        return;
      }

      setMessage("Eğer bu e-posta kayıtlıysa şifre yenileme bağlantısı gönderildi.");
      form.reset();
    } catch (error) {
      console.error("Password reset request failed:", error);
      setMessage("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.", true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
})();
