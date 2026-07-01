(function initRekabetliAvatars() {
  const PALETTE = [
    { bg: "#2d5a9e", fg: "#e8f2ff" },
    { bg: "#c45f12", fg: "#fff4e8" },
    { bg: "#1a7a5c", fg: "#e6fff5" },
    { bg: "#6b3fa0", fg: "#f3e8ff" },
    { bg: "#9e3d5c", fg: "#ffe8f0" },
    { bg: "#1f6b8a", fg: "#e3f6ff" },
  ];

  function hashString(value) {
    const text = String(value ?? "");
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function getInitials(name) {
    const parts = String(name || "?")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
  }

  function getAvatarPalette(seed) {
    const key = String(seed ?? "?").trim() || "?";
    return PALETTE[hashString(key) % PALETTE.length];
  }

  function escapeXml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildDefaultAvatarDataUrl(displayName, seed) {
    const initials = escapeXml(getInitials(displayName));
    const palette = getAvatarPalette(seed || displayName);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img"><rect width="128" height="128" fill="${palette.bg}"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="${palette.fg}" font-family="Inter,Montserrat,sans-serif" font-size="46" font-weight="700">${initials}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function styleFallbackElement(fallbackEl, seed) {
    if (!fallbackEl) return;
    const palette = getAvatarPalette(seed);
    fallbackEl.style.background = palette.bg;
    fallbackEl.style.color = palette.fg;
  }

  function setAvatarImage(imgEl, url, options = {}) {
    return (
      window.RekabetliSecurity?.setImgSrc(imgEl, url, {
        allowDataSvg: true,
        ...options,
      }) ?? false
    );
  }

  function showAvatarImage(imgEl, fallbackEl) {
    imgEl.hidden = false;
    fallbackEl.hidden = true;
    fallbackEl.textContent = "";
    fallbackEl.removeAttribute("style");
  }

  function showAvatarFallback(imgEl, fallbackEl, displayName, seed) {
    imgEl.hidden = true;
    imgEl.removeAttribute("src");
    imgEl.onload = null;
    imgEl.onerror = null;
    fallbackEl.hidden = false;
    fallbackEl.textContent = getInitials(displayName);
    styleFallbackElement(fallbackEl, seed);
  }

  function applyUserAvatar({ imgEl, fallbackEl, avatarUrl, displayName, seed, setImgOptions }) {
    if (!imgEl || !fallbackEl) return;

    const name = String(displayName ?? "").trim() || "Kullanıcı";
    const seedKey = String(seed ?? name).trim() || name;
    const userUrl = String(avatarUrl ?? "").trim();

    imgEl.onload = null;
    imgEl.onerror = null;

    if (userUrl) {
      if (setAvatarImage(imgEl, userUrl, setImgOptions)) {
        imgEl.alt = `${name} profil fotoğrafı`;
        showAvatarImage(imgEl, fallbackEl);
        imgEl.onload = () => showAvatarImage(imgEl, fallbackEl);
        imgEl.onerror = () => {
          const defaultUrl = buildDefaultAvatarDataUrl(name, seedKey);
          if (setAvatarImage(imgEl, defaultUrl, setImgOptions)) {
            imgEl.alt = `${name} profil fotoğrafı`;
            showAvatarImage(imgEl, fallbackEl);
            return;
          }
          showAvatarFallback(imgEl, fallbackEl, name, seedKey);
        };
        return;
      }

      showAvatarFallback(imgEl, fallbackEl, name, seedKey);
      return;
    }

    const defaultUrl = buildDefaultAvatarDataUrl(name, seedKey);
    if (setAvatarImage(imgEl, defaultUrl, setImgOptions)) {
      imgEl.alt = `${name} profil fotoğrafı`;
      showAvatarImage(imgEl, fallbackEl);
      return;
    }

    showAvatarFallback(imgEl, fallbackEl, name, seedKey);
  }

  function mountAvatar(container, options) {
    if (!container) return { imgEl: null, fallbackEl: null };

    const imgEl = document.createElement("img");
    if (options.imgClass) imgEl.className = options.imgClass;

    const fallbackEl = document.createElement("span");
    if (options.fallbackClass) fallbackEl.className = options.fallbackClass;

    container.append(imgEl, fallbackEl);
    applyUserAvatar({
      imgEl,
      fallbackEl,
      avatarUrl: options.avatarUrl,
      displayName: options.displayName,
      seed: options.seed,
    });

    return { imgEl, fallbackEl };
  }

  window.RekabetliAvatars = {
    getInitials,
    getAvatarPalette,
    buildDefaultAvatarDataUrl,
    applyUserAvatar,
    mountAvatar,
  };
})();
