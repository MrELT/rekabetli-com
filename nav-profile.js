(function initNavProfile() {
  async function readSession(supabaseClient) {
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) {
      console.error("Session check error:", sessionError.message);
    }

    if (sessionData.session) {
      return sessionData.session;
    }

    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    if (userError) {
      console.error("User check error:", userError.message);
      return null;
    }

    return userData.user ? { user: userData.user } : null;
  }

  async function syncProfileNavState() {
    const supabaseClient = window.getSupabase?.() || window.sb;
    if (!supabaseClient) return;

    const desktopProfileBtn = document.getElementById("desktop-profile-btn");
    const mobileProfileBtn = document.getElementById("mobile-profile-btn");
    if (!desktopProfileBtn && !mobileProfileBtn) return;

    const session = await readSession(supabaseClient);
    const isLoggedIn = Boolean(session?.user);
    const label = isLoggedIn ? "Profil" : "Giriş Yap";
    const targetHref = isLoggedIn ? "profile.html" : "login.html";

    if (desktopProfileBtn) {
      desktopProfileBtn.textContent = label;
      desktopProfileBtn.setAttribute("href", targetHref);
    }
    if (mobileProfileBtn) {
      mobileProfileBtn.textContent = label;
      mobileProfileBtn.setAttribute("href", targetHref);
    }
  }

  window.syncProfileNavState = syncProfileNavState;

  function bindAuthListener() {
    const supabaseClient = window.getSupabase?.() || window.sb;
    if (!supabaseClient) return false;

    supabaseClient.auth.onAuthStateChange(() => {
      syncProfileNavState();
    });

    syncProfileNavState();
    return true;
  }

  function tryBind() {
    if (bindAuthListener()) return;
    document.addEventListener("DOMContentLoaded", bindAuthListener);
    window.addEventListener("load", bindAuthListener);
  }

  tryBind();
})();
