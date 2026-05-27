/**
 * rekabetli.com — tarayıcı ortam değişkenleri
 * Kaynaklar (öncelik sırasıyla birleştirilir):
 *   window.__ENV__, window._env_, window.env, window.ENV
 *   env-config.local.js (npm run env:build / Vercel build)
 */
(function initRekabetliEnv() {
  const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

  if (!window.__REKABETLI_RUNTIME_GUARDS__) {
    window.__REKABETLI_RUNTIME_GUARDS__ = true;

    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        window.location.reload();
      }
    });

    window.addEventListener("unhandledrejection", (event) => {
      console.error("[rekabetli] Yakalanamayan promise hatası:", event.reason);
      event.preventDefault();
    });
  }

  const KEY_ALIASES = {
    SUPABASE_URL: ["SUPABASE_URL", "supabase_url", "supabaseUrl", "VITE_SUPABASE_URL"],
    SUPABASE_ANON_KEY: [
      "SUPABASE_ANON_KEY",
      "supabase_anon_key",
      "supabaseAnonKey",
      "VITE_SUPABASE_ANON_KEY",
    ],
  };

  function readValue(source, canonicalKey) {
    if (!source || typeof source !== "object") return "";
    for (const alias of KEY_ALIASES[canonicalKey] || [canonicalKey]) {
      const raw = source[alias];
      if (raw != null && String(raw).trim()) return String(raw).trim();
    }
    return "";
  }

  function normalizeSource(source) {
    const out = {};
    for (const key of ENV_KEYS) {
      const value = readValue(source, key);
      if (value) out[key] = value;
    }
    return out;
  }

  function getSourceObjects() {
    const g = typeof window !== "undefined" ? window : null;
    if (!g) return [];
    return [g.__ENV__, g._env_, g.env, g.ENV].filter(Boolean);
  }

  function mergeIntoTarget(target, patch) {
    const next = { ...target };
    for (const key of ENV_KEYS) {
      const value = patch[key];
      if (value) next[key] = value;
    }
    return next;
  }

  function mergeAllSources() {
    let merged = normalizeSource(window.__ENV__ || {});
    for (const source of getSourceObjects()) {
      merged = mergeIntoTarget(merged, normalizeSource(source));
    }
    return merged;
  }

  function getMissingKeys(env) {
    return ENV_KEYS.filter((key) => !env[key]);
  }

  function publishEnv(env) {
    window.__ENV__ = env;
    window.__ENV_READY__ = getMissingKeys(env).length === 0;
  }

  function warnMissing(env) {
    const missing = getMissingKeys(env);
    if (!missing.length) return;

    const isLocal =
      typeof location !== "undefined" &&
      /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);

    console.warn(
      "[rekabetli] Supabase ortam değişkenleri eksik:",
      missing.join(", "),
      isLocal
        ? "→ .env doldurup `npm run env:build` çalıştırın veya Vercel'de SUPABASE_URL / SUPABASE_ANON_KEY tanımlayın."
        : "→ Vercel Environment Variables ve build komutunda `npm run env:build` kontrol edin."
    );
  }

  function notifyEnvReady() {
    try {
      window.dispatchEvent(new CustomEvent("rekabetli-env-ready", { detail: window.__ENV__ }));
    } catch {
      /* IE11 yok; yoksay */
    }
  }

  function finalizeEnv() {
    const env = mergeAllSources();
    publishEnv(env);
    warnMissing(env);
    notifyEnvReady();
    return env;
  }

  /** Yerel / build çıktısı (env-config.local.js) bu fonksiyonu çağırır */
  window.__applyRekabetliEnv__ = function applyRekabetliEnv(patch) {
    if (!patch || typeof patch !== "object") return finalizeEnv();
    window.__ENV__ = mergeIntoTarget(window.__ENV__ || {}, normalizeSource(patch));
    return finalizeEnv();
  };

  window.getRekabetliEnv = function getRekabetliEnv(key) {
    return window.__ENV__?.[key];
  };

  /** Tüm sayfalarda anahtarların supabase-client'tan önce yüklenmesi (community.html vb.) */
  function tryLoadLocalEnvSync() {
    if (typeof XMLHttpRequest === "undefined" || typeof location === "undefined") return false;
    try {
      const base =
        (typeof document !== "undefined" &&
          document.currentScript?.src &&
          new URL(".", document.currentScript.src).href) ||
        location.href;
      const xhr = new XMLHttpRequest();
      xhr.open("GET", new URL("env-config.local.js", base).href, false);
      xhr.send(null);
      if (xhr.status !== 200 || !String(xhr.responseText || "").trim()) return false;
      // eslint-disable-next-line no-new-func
      new Function(xhr.responseText)();
      return true;
    } catch {
      return false;
    }
  }

  tryLoadLocalEnvSync();
  finalizeEnv();
})();
