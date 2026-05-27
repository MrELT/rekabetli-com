/**
 * Merkezi Supabase auth state — tek onAuthStateChange, getUser() yok.
 * Tüketiciler: RekabetliAuth.subscribe / getUser / whenReady
 */
(function initRekabetliAuthStore() {
  const subscribers = new Set();

  let state = {
    ready: false,
    session: null,
    user: null,
    event: null,
  };

  let authSubscription = null;
  let listenerBound = false;

  function getClient() {
    return window.getSupabase?.() || window.sb || null;
  }

  function snapshot() {
    return {
      ready: state.ready,
      session: state.session,
      user: state.user,
      event: state.event,
    };
  }

  function notifySubscribers() {
    const current = snapshot();
    subscribers.forEach((fn) => {
      try {
        fn(current);
      } catch (err) {
        console.error("[rekabetli][auth-store] subscriber error:", err);
      }
    });
  }

  function applyState(patch) {
    state = { ...state, ...patch };
    queueMicrotask(notifySubscribers);
  }

  function bindAuthListener(sb) {
    if (listenerBound || !sb?.auth?.onAuthStateChange) return;
    listenerBound = true;

    const { data } = sb.auth.onAuthStateChange((event, session) => {
      applyState({
        ready: true,
        session: session ?? null,
        user: session?.user ?? null,
        event,
      });
    });
    authSubscription = data?.subscription ?? null;
  }

  function teardownListener() {
    if (authSubscription?.unsubscribe) {
      authSubscription.unsubscribe();
    }
    authSubscription = null;
    listenerBound = false;
  }

  async function bootstrap() {
    const sb = getClient();

    if (!sb || sb._rekabetliStub) {
      applyState({
        ready: true,
        session: null,
        user: null,
        event: sb?._rekabetliStub ? "STUB_CLIENT" : "NO_CLIENT",
      });
      return;
    }

    try {
      const { data, error } = await sb.auth.getSession();
      if (error) {
        console.warn("[rekabetli][auth-store] getSession:", error.message);
      }
      const session = data?.session ?? null;
      applyState({
        ready: true,
        session,
        user: session?.user ?? null,
        event: "INITIAL_SESSION",
      });
    } catch (err) {
      console.error("[rekabetli][auth-store] bootstrap error:", err);
      applyState({
        ready: true,
        session: null,
        user: null,
        event: "BOOTSTRAP_ERROR",
      });
    }

    bindAuthListener(sb);
  }

  async function refreshSession() {
    const sb = getClient();
    if (!sb || sb._rekabetliStub) return;

    try {
      const { data, error } = await sb.auth.getSession();
      if (error) {
        console.warn("[rekabetli][auth-store] refreshSession:", error.message);
        return;
      }
      const session = data?.session ?? null;
      applyState({
        session,
        user: session?.user ?? null,
        event: "REFRESH",
      });
    } catch (err) {
      console.error("[rekabetli][auth-store] refreshSession error:", err);
    }
  }

  function rebootstrap() {
    teardownListener();
    void bootstrap();
  }

  const RekabetliAuth = {
    getState: snapshot,

    getUser() {
      return state.user ?? null;
    },

    whenReady() {
      if (state.ready) return Promise.resolve(snapshot());
      return new Promise((resolve) => {
        const unsub = RekabetliAuth.subscribe((s) => {
          if (s.ready) {
            unsub();
            resolve(s);
          }
        });
      });
    },

    subscribe(fn) {
      subscribers.add(fn);
      if (state.ready) {
        queueMicrotask(() => fn(snapshot()));
      }
      return () => subscribers.delete(fn);
    },

    refreshSession,
    rebootstrap,
  };

  window.RekabetliAuth = RekabetliAuth;
  window.rekabetliAuth = RekabetliAuth;

  void bootstrap();

  window.addEventListener("rekabetli-env-ready", () => {
    const sb = getClient();
    if (sb && !sb._rekabetliStub) {
      rebootstrap();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (!state.ready) void bootstrap();
    });
  }
})();
