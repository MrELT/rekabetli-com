(function initSupabaseClient() {
  const SUPABASE_URL = window.__ENV__?.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.__ENV__?.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error(
      "[rekabetli] Supabase yapılandırması eksik. .env dosyasını oluşturup `npm run env:build` çalıştırın (env-config.js üretilir)."
    );
    return;
  }

  function createClientIfNeeded() {
    if (window.sb) return window.sb;
    if (!window.supabase?.createClient) return null;
    window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return window.sb;
  }

  window.getSupabase = function getSupabase() {
    return createClientIfNeeded();
  };

  createClientIfNeeded();

  if (!window.sb) {
    document.addEventListener("DOMContentLoaded", createClientIfNeeded);
  }
})();
