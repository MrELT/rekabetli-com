(function initNavProfile() {
  function syncProfileNavState(passedUser = null) {
    const desktopProfileBtn = document.getElementById("desktop-profile-btn");
    const mobileProfileBtn = document.getElementById("mobile-profile-btn");
    if (!desktopProfileBtn && !mobileProfileBtn) return;

    let sessionUser = passedUser;

    if (!sessionUser && window.RekabetliAuth) {
      const { ready, user } = window.RekabetliAuth.getState();
      if (!ready) return;
      sessionUser = user;
    }

    const isLoggedIn = Boolean(sessionUser?.id);
    const label = isLoggedIn ? "Profil" : "Giriş Yap";
    const targetHref = isLoggedIn ? "/profile" : "/login";

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

  function initFromAuthStore() {
    const auth = window.RekabetliAuth;
    if (!auth) {
      syncProfileNavState();
      return;
    }

    auth.subscribe((authState) => {
      if (!authState.ready) return;
      syncProfileNavState(authState.user);
    });

    const initial = auth.getState();
    if (initial.ready) {
      syncProfileNavState(initial.user);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFromAuthStore);
  } else {
    initFromAuthStore();
  }
})();
