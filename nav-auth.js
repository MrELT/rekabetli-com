(function initNavAuth() {
  function getClient() {
    return window.getSupabase?.() || window.sb || null;
  }

  document.addEventListener("click", (event) => {
    const mobileMenu = document.getElementById("mobile-menu");
    if (!mobileMenu) return;
    let target = event.target;
    if (target && target.nodeType === Node.TEXT_NODE) {
      target = target.parentElement;
    }
    if (!target || typeof target.closest !== "function") return;

    if (target.closest("#open-mobile-menu")) {
      mobileMenu.hidden = false;
    }

    if (target.closest("#close-mobile-menu") || target.id === "mobile-menu") {
      mobileMenu.hidden = true;
    }
  });

  const addTypeLabels = {
    community: "topluluk",
    competition: "yarışma",
    exam: "sınav",
  };

  async function handlePanelAddClick(event) {
    const button = event.currentTarget;
    const addType = button.dataset.addType;
    if (!addType) return;

    const supabaseClient = getClient();
    if (!supabaseClient) {
      window.alert("Bağlantı hazırlanıyor. Lütfen sayfayı yenileyin.");
      return;
    }

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      window.location.href = "/login";
      return;
    }

    if (addType === "community") {
      if (typeof window.rekabetliOpenCommunityModal === "function") {
        await window.rekabetliOpenCommunityModal(event);
      } else if (typeof window.openCommunityModal === "function") {
        window.openCommunityModal();
      } else {
        window.alert("Topluluk formu yüklenemedi. Sayfayı yenileyin (Ctrl+F5).");
      }
      return;
    }

    const label = addTypeLabels[addType] || "içerik";
    if (typeof window.rekabetliAlert === "function") {
      await window.rekabetliAlert({
        title: "Yakında",
        message: `${label.charAt(0).toUpperCase()}${label.slice(1)} ekleme özelliği çok yakında burada olacak.`,
      });
      return;
    }

    window.alert(`${label} ekleme özelliği yakında eklenecek.`);
  }

  function bindPanelAddButtons() {
    document.querySelectorAll(".js-panel-add-btn").forEach((button) => {
      if (button.dataset.navAddBound === "1") return;
      button.dataset.navAddBound = "1";
      button.addEventListener("click", handlePanelAddClick);
    });
  }

  function init() {
    bindPanelAddButtons();
    window.syncProfileNavState?.();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
