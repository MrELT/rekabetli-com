/**
 * Referral attribution — ?ref= /r/CODE yakalama, 30 gün hatırlama, kayıt bağlama.
 */
(function initRekabetliReferral() {
  const STORAGE_KEY = "rekabetli.referral.v1";
  const SESSION_KEY = "rekabetli.referral.session";
  const CLICK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  let claimInFlight = false;

  function getSupabase() {
    return window.getSupabase?.() || window.sb || null;
  }

  function normalizeCode(raw) {
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function readStoredReferral() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const code = normalizeCode(parsed?.code);
      const clickedAt = Number(parsed?.clickedAt);
      if (!code || !Number.isFinite(clickedAt)) return null;
      if (Date.now() - clickedAt > CLICK_WINDOW_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return { code, clickedAt, sessionId: String(parsed?.sessionId || "") };
    } catch {
      return null;
    }
  }

  function writeStoredReferral(payload) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  function getOrCreateSessionId() {
    try {
      let sessionId = localStorage.getItem(SESSION_KEY);
      if (sessionId && sessionId.length >= 8) return sessionId;
      sessionId =
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `rkl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem(SESSION_KEY, sessionId);
      return sessionId;
    } catch {
      return `rkl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function extractRefFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = normalizeCode(params.get("ref"));
    if (fromQuery) return fromQuery;

    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts[0] === "r" && parts[1]) {
      return normalizeCode(decodeURIComponent(parts[1]));
    }
    return "";
  }

  function captureReferralFromUrl() {
    const code = extractRefFromUrl();
    if (!code) return null;

    const sessionId = getOrCreateSessionId();
    const payload = { code, clickedAt: Date.now(), sessionId };
    writeStoredReferral(payload);
    return payload;
  }

  async function recordClick(payload) {
    const supabase = getSupabase();
    if (!supabase?.rpc || !payload?.code) return;

    try {
      await supabase.rpc("record_referral_click", {
        p_code: payload.code,
        p_session_id: payload.sessionId || getOrCreateSessionId(),
        p_landing_path: `${window.location.pathname}${window.location.search}`.slice(0, 500),
      });
    } catch (error) {
      console.warn("[rekabetli][referral] record_referral_click:", error?.message || error);
    }
  }

  async function claimReferralAttribution() {
    if (claimInFlight) return null;
    const supabase = getSupabase();
    if (!supabase?.rpc) return null;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) return null;

    const stored = readStoredReferral();
    const sessionId = stored?.sessionId || getOrCreateSessionId();
    if (!stored && !sessionId) return null;

    claimInFlight = true;
    try {
      const { data, error } = await supabase.rpc("claim_referral_attribution", {
        p_code: stored?.code || null,
        p_session_id: sessionId,
      });
      if (error) {
        if (!String(error.message || "").includes("referral_self_not_allowed")) {
          console.warn("[rekabetli][referral] claim:", error.message);
        }
        return null;
      }
      return data;
    } finally {
      claimInFlight = false;
    }
  }

  function getPublicReferralLink(code) {
    const normalized = normalizeCode(code);
    if (!normalized) return "";
    const origin = window.location.origin.replace(/\/$/, "");
    return `${origin}/r/${encodeURIComponent(normalized)}`;
  }

  async function bootstrapReferral() {
    const captured = captureReferralFromUrl();
    const stored = captured || readStoredReferral();
    if (stored) {
      void recordClick(stored);
    }

    const auth = window.RekabetliAuth;
    if (auth) {
      auth.subscribe((state) => {
        if (!state.ready || !state.user?.id) return;
        if (state.event === "SIGNED_IN" || state.event === "INITIAL_SESSION") {
          void claimReferralAttribution();
        }
      });
    } else {
      const supabase = getSupabase();
      supabase?.auth?.onAuthStateChange?.((event, session) => {
        if (session?.user && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
          void claimReferralAttribution();
        }
      });
    }
  }

  window.RekabetliReferral = {
    readStoredReferral,
    captureReferralFromUrl,
    claimReferralAttribution,
    getPublicReferralLink,
    getOrCreateSessionId,
    normalizeCode,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void bootstrapReferral();
    });
  } else {
    void bootstrapReferral();
  }
})();
