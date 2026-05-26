(function initResetPassword() {
  const supabaseClient = window.getSupabase?.() || window.sb;
  const form = document.getElementById("reset-password-form");
  const messageEl = document.getElementById("reset-password-message");
  const submitBtn = document.getElementById("reset-password-submit");

  function setMessage(text, isError = false) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.classList.toggle("profile-message-error", isError);
  }

  function setFormEnabled(isEnabled) {
    if (submitBtn) submitBtn.disabled = !isEnabled;
    form?.querySelectorAll("input").forEach((input) => {
      input.disabled = !isEnabled;
    });
  }

  async function ensureRecoverySession() {
    if (!supabaseClient) {
      setMessage("Bağlantı hazırlanamadı. Lütfen bağlantıyı tekrar açın.", true);
      setFormEnabled(false);
      return false;
    }

    try {
      const initialSession = await supabaseClient.auth.getSession();
      if (initialSession.data.session) return true;

      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("Password recovery code exchange error:", error.message);
        }
      }

      const { data } = await supabaseClient.auth.getSession();
      if (data.session) return true;
    } catch (error) {
      console.error("Password recovery session error:", error);
    }

    setMessage("Şifre yenileme bağlantısı geçersiz veya süresi dolmuş. Lütfen yeniden e-posta isteyin.", true);
    setFormEnabled(false);
    return false;
  }

  if (!form) return;

  void ensureRecoverySession();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");

    const data = new FormData(form);
    const password = String(data.get("password") || "");
    const passwordConfirm = String(data.get("passwordConfirm") || "");

    if (password.length < 6) {
      setMessage("Şifre en az 6 karakter olmalı.", true);
      return;
    }

    if (password !== passwordConfirm) {
      setMessage("Şifreler eşleşmiyor.", true);
      return;
    }

    if (!(await ensureRecoverySession())) return;

    if (submitBtn) submitBtn.disabled = true;

    try {
      const { error } = await supabaseClient.auth.updateUser({ password });
      if (error) {
        console.error("Password update error:", error.message);
        setMessage("Şifre güncellenemedi. Bağlantı süresi dolmuş olabilir.", true);
        return;
      }

      setMessage("Şifren güncellendi. Giriş ekranına yönlendiriliyorsun.");
      await supabaseClient.auth.signOut();
      window.setTimeout(() => {
        window.location.href = "/login";
      }, 1200);
    } catch (error) {
      console.error("Password update failed:", error);
      setMessage("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.", true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
})();
