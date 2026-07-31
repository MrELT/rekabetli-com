(function initNavProfile() {
  const CACHE_KEY = "rekabetli_panel_home_v1";
  const MENTOR_HOME = "/mentor-sayfam";
  const STUDENT_HOME = "/ogrenci-sayfam";

  function readCache(userId) {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.userId !== userId || !parsed.path) return null;
      return parsed.path;
    } catch {
      return null;
    }
  }

  function writeCache(userId, path) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ userId, path }));
    } catch {
      /* ignore quota */
    }
  }

  function clearCache() {
    try {
      sessionStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }

  function pathFromProfile(profile) {
    const isMentor =
      Boolean(profile?.is_mentor) ||
      String(profile?.user_type || "")
        .trim()
        .toLowerCase() === "mentor";
    return isMentor ? MENTOR_HOME : STUDENT_HOME;
  }

  function applyHref(path) {
    const desktopProfileBtn = document.getElementById("desktop-profile-btn");
    const mobileProfileBtn = document.getElementById("mobile-profile-btn");
    if (desktopProfileBtn) desktopProfileBtn.setAttribute("href", path);
    if (mobileProfileBtn) mobileProfileBtn.setAttribute("href", path);
  }

  function applyLoggedOut() {
    const desktopProfileBtn = document.getElementById("desktop-profile-btn");
    const mobileProfileBtn = document.getElementById("mobile-profile-btn");
    if (desktopProfileBtn) {
      desktopProfileBtn.textContent = "Giriş Yap";
      desktopProfileBtn.setAttribute("href", "/login");
    }
    if (mobileProfileBtn) {
      mobileProfileBtn.textContent = "Giriş Yap";
      mobileProfileBtn.setAttribute("href", "/login");
    }
  }

  function applyLoggedInLabel(path) {
    const desktopProfileBtn = document.getElementById("desktop-profile-btn");
    const mobileProfileBtn = document.getElementById("mobile-profile-btn");
    if (desktopProfileBtn) {
      desktopProfileBtn.textContent = "Profil";
      desktopProfileBtn.setAttribute("href", path);
    }
    if (mobileProfileBtn) {
      mobileProfileBtn.textContent = "Profil";
      mobileProfileBtn.setAttribute("href", path);
    }
  }

  async function resolvePanelHome(user) {
    if (!user?.id) return STUDENT_HOME;

    const cached = readCache(user.id);
    if (cached) return cached;

    const supabase = window.getSupabase?.() || window.sb;
    if (!supabase || supabase._rekabetliStub) {
      return STUDENT_HOME;
    }

    try {
      const { data } = await supabase
        .from("profiles")
        .select("is_mentor, user_type")
        .eq("id", user.id)
        .maybeSingle();
      const path = pathFromProfile(data);
      writeCache(user.id, path);
      return path;
    } catch (error) {
      console.warn("[rekabetli][panel-home]", error);
      return STUDENT_HOME;
    }
  }

  async function syncProfileNavState(passedUser = null) {
    const desktopProfileBtn = document.getElementById("desktop-profile-btn");
    const mobileProfileBtn = document.getElementById("mobile-profile-btn");
    if (!desktopProfileBtn && !mobileProfileBtn) return;

    let sessionUser = passedUser;

    if (!sessionUser && window.RekabetliAuth) {
      const { ready, user } = window.RekabetliAuth.getState();
      if (!ready) return;
      sessionUser = user;
    }

    if (!sessionUser?.id) {
      clearCache();
      applyLoggedOut();
      return;
    }

    const cached = readCache(sessionUser.id);
    applyLoggedInLabel(cached || STUDENT_HOME);

    const path = await resolvePanelHome(sessionUser);
    applyHref(path);
  }

  window.RekabetliPanelHome = {
    MENTOR_HOME,
    STUDENT_HOME,
    pathFromProfile,
    resolve: resolvePanelHome,
    setPath(userId, path) {
      if (!userId || !path) return;
      writeCache(userId, path);
      applyHref(path);
    },
    clear: clearCache,
  };

  window.syncProfileNavState = syncProfileNavState;

  function initFromAuthStore() {
    const auth = window.RekabetliAuth;
    if (!auth) {
      void syncProfileNavState();
      return;
    }

    auth.subscribe((authState) => {
      if (!authState.ready) return;
      void syncProfileNavState(authState.user);
    });

    const initial = auth.getState();
    if (initial.ready) {
      void syncProfileNavState(initial.user);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFromAuthStore);
  } else {
    initFromAuthStore();
  }
})();
