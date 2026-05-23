(function initSupabaseClient() {
  const CONFIG_HINT =
    "Supabase yapılandırması eksik. Yerelde: npm run env:build · Canlı: Vercel SUPABASE_URL ve SUPABASE_ANON_KEY.";

  let stubClient = null;
  let warnedMissing = false;

  function getEnv() {
    return window.__ENV__ || {};
  }

  function hasConfig() {
    const env = getEnv();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  }

  function warnOnce() {
    if (warnedMissing || hasConfig()) return;
    warnedMissing = true;
    console.warn("[rekabetli]", CONFIG_HINT);
  }

  function createQueryStub() {
    const err = { message: CONFIG_HINT };
    const chain = {
      select: () => chain,
      insert: () => chain,
      update: () => chain,
      upsert: () => chain,
      delete: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: null, error: err }),
      single: async () => ({ data: null, error: err }),
      then(resolve) {
        return Promise.resolve({ data: null, error: err }).then(resolve);
      },
    };
    return chain;
  }

  function createStubClient() {
    if (stubClient) return stubClient;

    const authError = { message: CONFIG_HINT };
    stubClient = {
      _rekabetliStub: true,
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        signInWithPassword: async () => ({ data: { session: null }, error: authError }),
        signUp: async () => ({ data: { user: null }, error: authError }),
        signOut: async () => ({ error: null }),
        onAuthStateChange(callback) {
          if (typeof callback === "function") {
            queueMicrotask(() => callback("INITIAL_SESSION", null));
          }
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
      from: () => createQueryStub(),
      storage: {
        from: () => ({
          upload: async () => ({ data: null, error: authError }),
          getPublicUrl: () => ({ data: { publicUrl: "" } }),
        }),
      },
      rpc: async () => ({ data: null, error: authError }),
    };

    return stubClient;
  }

  function createRealClient() {
    const env = getEnv();
    if (!window.supabase?.createClient) return null;
    return window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  }

  function createClientIfNeeded() {
    if (window.sb && !window.sb._rekabetliStub) return window.sb;

    if (!hasConfig()) {
      warnOnce();
      window.sb = createStubClient();
      return window.sb;
    }

    if (!window.supabase?.createClient) return window.sb || null;

    try {
      window.sb = createRealClient();
      return window.sb;
    } catch (error) {
      console.error("[rekabetli] Supabase istemcisi oluşturulamadı:", error);
      window.sb = createStubClient();
      return window.sb;
    }
  }

  window.getSupabase = function getSupabase() {
    return createClientIfNeeded() || createStubClient();
  };

  window.isRekabetliSupabaseConfigured = function isRekabetliSupabaseConfigured() {
    return hasConfig() && Boolean(window.sb && !window.sb._rekabetliStub);
  };

  function bootstrap() {
    createClientIfNeeded();
  }

  bootstrap();

  window.addEventListener("rekabetli-env-ready", () => {
    if (window.sb?._rekabetliStub && hasConfig()) {
      window.sb = null;
    }
    bootstrap();
  });

  if (!window.sb || window.sb._rekabetliStub) {
    document.addEventListener("DOMContentLoaded", bootstrap);
  }

  if (!window.supabase?.createClient) {
    const poll = setInterval(() => {
      if (window.supabase?.createClient) {
        clearInterval(poll);
        bootstrap();
      }
    }, 50);
    setTimeout(() => clearInterval(poll), 10000);
  }
})();
