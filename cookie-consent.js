/**
 * KVKK uyumlu çerez / depolama onayı — tüm sayfalarda site-footer.js ile yüklenir.
 */
(function initRekabetliCookieConsent() {
  const STORAGE_KEY = "rekabetli.cookie-consent.v1";
  const COOKIE_NAME = "rek_consent";
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

  function readStoredConsent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const choice = String(parsed?.choice || "").trim();
      if (choice !== "all" && choice !== "essential") return null;
      return { choice, at: Number(parsed?.at) || Date.now() };
    } catch {
      return null;
    }
  }

  function writeCookie(choice) {
    try {
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(choice)};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
    } catch {
      /* ignore */
    }
  }

  function persistConsent(choice) {
    const payload = { choice, at: Date.now() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    writeCookie(choice);
    window.dispatchEvent(
      new CustomEvent("rekabetli:cookie-consent", { detail: payload }),
    );
  }

  function removeBanner() {
    document.getElementById("rekabetli-cookie-consent")?.remove();
    document.documentElement.classList.remove("has-cookie-consent");
  }

  function mountBanner() {
    if (document.getElementById("rekabetli-cookie-consent")) return;

    const banner = document.createElement("aside");
    banner.id = "rekabetli-cookie-consent";
    banner.className = "cookie-consent-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-labelledby", "cookie-consent-title");
    banner.setAttribute("aria-live", "polite");

    const card = document.createElement("div");
    card.className = "cookie-consent-card";

    const inner = document.createElement("div");
    inner.className = "cookie-consent-inner";

    const copy = document.createElement("div");
    copy.className = "cookie-consent-copy";

    const icon = document.createElement("span");
    icon.className = "cookie-consent-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12 2C8.5 2 5.5 4.2 4.3 7.4c-.2.5-.3 1-.3 1.6 0 3.9 3.1 7 7 7s7-3.1 7-7c0-.6-.1-1.1-.3-1.6C18.5 4.2 15.5 2 12 2Z" stroke="currentColor" stroke-width="1.5"/>' +
      '<circle cx="9" cy="10" r="1" fill="currentColor"/>' +
      '<circle cx="14" cy="9" r="1" fill="currentColor"/>' +
      '<circle cx="11.5" cy="13" r="1" fill="currentColor"/>' +
      "</svg>";

    const textWrap = document.createElement("div");
    textWrap.className = "cookie-consent-text-wrap";

    const title = document.createElement("p");
    title.id = "cookie-consent-title";
    title.className = "cookie-consent-title";
    title.textContent = "Çerezler ve yerel depolama";

    const text = document.createElement("p");
    text.className = "cookie-consent-text";
    text.innerHTML =
      'Oturum, güvenlik ve tercihleriniz için zorunlu çerezler kullanılır. Analitik çerezler yalnızca onayınızla etkinleşir. ' +
      '<a href="/kvkk" target="_blank" rel="noopener noreferrer">KVKK Aydınlatma Metni</a>';

    textWrap.append(title, text);
    copy.append(icon, textWrap);

    const actions = document.createElement("div");
    actions.className = "cookie-consent-actions";

    const essentialBtn = document.createElement("button");
    essentialBtn.type = "button";
    essentialBtn.className = "cookie-consent-btn cookie-consent-btn--secondary";
    essentialBtn.textContent = "Yalnızca zorunlu";
    essentialBtn.addEventListener("click", () => {
      persistConsent("essential");
      removeBanner();
    });

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "cookie-consent-btn cookie-consent-btn--primary";
    acceptBtn.textContent = "Tümünü kabul et";
    acceptBtn.addEventListener("click", () => {
      persistConsent("all");
      removeBanner();
    });

    actions.append(essentialBtn, acceptBtn);
    inner.append(copy, actions);
    card.appendChild(inner);
    banner.appendChild(card);
    document.body.appendChild(banner);
    document.documentElement.classList.add("has-cookie-consent");
  }

  window.RekabetliCookieConsent = {
    getChoice() {
      return readStoredConsent()?.choice || null;
    },
    hasAnalyticsConsent() {
      return readStoredConsent()?.choice === "all";
    },
    reset() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      writeCookie("");
      mountBanner();
    },
  };

  if (readStoredConsent()) return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountBanner, { once: true });
  } else {
    mountBanner();
  }
})();
