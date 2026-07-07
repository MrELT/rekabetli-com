(function initPaymentSuccessPage() {
  const supabase = window.getSupabase?.() || window.sb;
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id")?.trim() || "";

  const titleEl = document.getElementById("payment-result-title");
  const messageEl = document.getElementById("payment-result-message");
  const detailEl = document.getElementById("payment-result-detail");
  const actionsEl = document.getElementById("payment-result-actions");
  const primaryEl = document.getElementById("payment-result-primary");
  const secondaryEl = document.getElementById("payment-result-secondary");

  const MAX_ATTEMPTS = 60;
  const POLL_MS = 1500;

  function setState({ title, message, detail = "", showActions = false, primaryHref = "/ogrenci-sayfam" }) {
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (detailEl) {
      detailEl.textContent = detail;
      detailEl.hidden = !detail;
    }
    if (actionsEl) actionsEl.hidden = !showActions;
    if (primaryEl) primaryEl.href = primaryHref;
  }

  async function ensureSession() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user?.id) return session;
    const redirect = `/odeme/basarili?session_id=${encodeURIComponent(sessionId)}`;
    window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`;
    return null;
  }

  async function confirmCheckoutSession() {
    if (!supabase?.functions?.invoke) return null;

    const { data, error } = await supabase.functions.invoke("confirm-package-checkout", {
      body: { sessionId },
    });

    if (error) {
      let detail = error.message || "confirm_failed";
      const context = error?.context;
      if (context && typeof context.json === "function") {
        try {
          const body = await context.json();
          detail = body?.message || body?.error || detail;
        } catch {
          /* ignore */
        }
      }
      console.warn("confirm checkout:", detail, error.message);
      return { error: detail };
    }

    return data && typeof data === "object" ? data : null;
  }

  async function pollOrderStatus(attempt = 0) {
    if (attempt === 0 || (attempt > 0 && attempt % 3 === 0)) {
      const confirmData = await confirmCheckoutSession();
      if (
        confirmData &&
        !confirmData.error &&
        String(confirmData.status || "") === "paid" &&
        confirmData.enrollment_id
      ) {
        const enrollmentId = String(confirmData.enrollment_id);
        setState({
          title: "Ödeme tamamlandı",
          message: "Paket kaydınız oluşturuldu.",
          detail: "Danışman panelinizden mentörünüzle iletişime geçebilirsiniz.",
          showActions: true,
          primaryHref: `/ogrenci-sayfam#kayit-${encodeURIComponent(enrollmentId)}`,
        });
        window.rekabetliNotifications?.refresh?.();
        return;
      }
    }

    const { data, error } = await supabase.rpc("get_my_package_order_by_checkout_session", {
      p_stripe_checkout_session_id: sessionId,
    });

    if (error) {
      console.error("payment status:", error.message);
      setState({
        title: "Durum alınamadı",
        message: "Ödeme kaydı sorgulanamadı. Birkaç dakika sonra danışman panelinizi kontrol edin.",
        showActions: true,
      });
      return;
    }

    if (!data) {
      if (attempt < MAX_ATTEMPTS) {
        window.setTimeout(() => void pollOrderStatus(attempt + 1), POLL_MS);
        return;
      }
      setState({
        title: "İşlem sürüyor",
        message:
          "Ödemeniz alınmış olabilir; kayıt henüz görünmüyor. Danışman panelinizi biraz sonra yenileyin.",
        showActions: true,
      });
      return;
    }

    const status = String(data.status || "");
    const packageTitle = String(data.package_title || "Paket");
    const enrollmentId = data.enrollment_id ? String(data.enrollment_id) : "";

    if (status === "paid" && enrollmentId) {
      setState({
        title: "Ödeme tamamlandı",
        message: `${packageTitle} paketine kaydınız oluşturuldu.`,
        detail: "Danışman panelinizden mentörünüzle iletişime geçebilirsiniz.",
        showActions: true,
        primaryHref: `/ogrenci-sayfam#kayit-${encodeURIComponent(enrollmentId)}`,
      });
      if (secondaryEl && data.mentor_id) {
        secondaryEl.href = `/mentor?id=${encodeURIComponent(String(data.mentor_id))}`;
        secondaryEl.textContent = "Mentör vitrinine dön";
      }
      window.rekabetliNotifications?.refresh?.();
      return;
    }

    if (status === "paid") {
      setState({
        title: "Ödeme tamamlandı",
        message: `${packageTitle} için ödemeniz alındı.`,
        showActions: true,
      });
      return;
    }

    if (status === "expired" || status === "canceled") {
      setState({
        title: "Ödeme tamamlanmadı",
        message: "Ödeme oturumu sona erdi veya iptal edildi.",
        showActions: true,
        primaryHref: data.mentor_id
          ? `/mentor?id=${encodeURIComponent(String(data.mentor_id))}`
          : "/mentors",
      });
      if (primaryEl) primaryEl.textContent = "Mentör vitrinine dön";
      return;
    }

    if (attempt < MAX_ATTEMPTS) {
      window.setTimeout(() => void pollOrderStatus(attempt + 1), POLL_MS);
      return;
    }

    const finalConfirm = await confirmCheckoutSession();
    if (finalConfirm?.error) {
      setState({
        title: "Onay gecikti",
        message:
          "Ödeme alındı ancak onay gecikiyor olabilir. Lütfen 1-2 dakika sonra bu sayfayı yenileyin.",
        detail: `Teknik detay: ${finalConfirm.error}`,
        showActions: true,
      });
      return;
    }

    setState({
      title: "İşlem sürüyor",
      message: "Ödeme onayı bekleniyor. Danışman panelinizi kısa süre içinde kontrol edin.",
      detail: "Onay gecikirse sayfayı 1-2 dakika sonra yenileyin.",
      showActions: true,
    });
  }

  async function boot() {
    if (!supabase) {
      setState({
        title: "Sayfa yüklenemedi",
        message: "Bağlantı kurulamadı.",
        showActions: true,
      });
      return;
    }

    if (!sessionId) {
      setState({
        title: "Geçersiz bağlantı",
        message: "Ödeme oturumu bulunamadı.",
        showActions: true,
        primaryHref: "/mentors",
      });
      return;
    }

    const session = await ensureSession();
    if (!session) return;

    await pollOrderStatus(0);
  }

  void boot();
})();
