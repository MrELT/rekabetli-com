(async function initUnsubscribePage() {
  const messageEl = document.getElementById("unsubscribe-message");
  const subtitleEl = document.querySelector(".auth-subtitle");
  const setMessage = (text, isError = false) => {
    if (subtitleEl) {
      subtitleEl.textContent = isError ? "İşlem tamamlanamadı." : "İşlem tamamlandı.";
    }
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.classList.toggle("profile-message-error", Boolean(isError));
  };

  try {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setMessage("Geçersiz abonelikten çıkış bağlantısı.", true);
      return;
    }

    const sb = window.getSupabase?.() || window.sb;
    if (!sb || sb._rekabetliStub) {
      setMessage("Bağlantı kurulamadı. Lütfen daha sonra tekrar deneyin.", true);
      return;
    }

    const { data, error } = await sb.rpc("unsubscribe_marketing_by_token", {
      p_token: token,
    });

    if (error) {
      console.error("unsubscribe error:", error);
      setMessage("Abonelikten çıkış sırasında bir hata oluştu.", true);
      return;
    }

    if (!data) {
      setMessage("Bağlantı geçersiz veya daha önce kullanılmış olabilir.", true);
      return;
    }

    setMessage("Kampanya e-postalarından başarıyla çıktınız.");
  } catch (err) {
    console.error("unsubscribe fatal error:", err);
    setMessage("Abonelikten çıkış sırasında beklenmeyen bir hata oluştu.", true);
  }
})();
