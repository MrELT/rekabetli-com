/**
 * Tüm sitede kapatılamayan bakım katmanı.
 * Sorun çözülünce `ENABLED` değerini false yapın — lib/site-maintenance.ts ile birlikte.
 */
(function initRekabetliMaintenance() {
  const ENABLED = false;
  const REOPEN_LABEL = "Çok yakında";

  if (!ENABLED) return;
  if (window.__REKABETLI_MAINTENANCE__) return;
  window.__REKABETLI_MAINTENANCE__ = true;

  const CSS = `
html.rek-maintenance-lock, html.rek-maintenance-lock body {
  overflow: hidden !important;
  height: 100% !important;
  pointer-events: none !important;
}
.rek-maintenance {
  pointer-events: auto !important;
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  overflow: auto;
  background:
    radial-gradient(circle at 12% 15%, rgba(255, 138, 30, 0.16), transparent 32%),
    radial-gradient(circle at 82% 8%, rgba(45, 140, 255, 0.18), transparent 38%),
    linear-gradient(160deg, #0b111b 0%, #0f1725 100%);
  color: #e8eefc;
  font-family: Inter, "Segoe UI", Arial, sans-serif;
}
.rek-maintenance-card {
  width: min(100%, 440px);
  padding: 2rem 1.7rem 1.65rem;
  border-radius: 22px;
  border: 1px solid rgba(148, 181, 236, 0.28);
  background: linear-gradient(145deg, rgba(14, 24, 42, 0.92), rgba(8, 14, 28, 0.88));
  box-shadow:
    0 28px 70px rgba(0, 0, 0, 0.48),
    0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  text-align: center;
}
.rek-maintenance-logo {
  display: block;
  height: 36px;
  width: auto;
  margin: 0 auto 1.15rem;
}
.rek-maintenance-badge {
  display: inline-flex;
  align-items: center;
  margin: 0 0 0.85rem;
  padding: 0.28rem 0.7rem;
  border-radius: 999px;
  background: rgba(255, 138, 30, 0.14);
  color: #ffb04a;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.rek-maintenance-title {
  margin: 0 0 0.65rem;
  font-family: Montserrat, Inter, "Segoe UI", sans-serif;
  font-size: 1.45rem;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.03em;
}
.rek-maintenance-text {
  margin: 0 0 1.15rem;
  color: #9caaca;
  font-size: 0.98rem;
  line-height: 1.55;
}
.rek-maintenance-date {
  margin: 0 0 1.2rem;
  padding: 0.85rem 1rem;
  border-radius: 14px;
  border: 1px solid rgba(45, 140, 255, 0.28);
  background: rgba(45, 140, 255, 0.1);
}
.rek-maintenance-date span {
  display: block;
  color: #9caaca;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.rek-maintenance-date strong {
  display: block;
  margin-top: 0.2rem;
  color: #e8eefc;
  font-size: 1.15rem;
  font-weight: 800;
}
.rek-maintenance-note {
  margin: 0;
  color: #9caaca;
  font-size: 0.88rem;
  line-height: 1.5;
}
.rek-maintenance-note a {
  color: #ffb04a;
  font-weight: 600;
  text-decoration: none;
}
.rek-maintenance-note a:hover {
  text-decoration: underline;
}
`;

  function injectStyles() {
    if (document.getElementById("rekabetli-maintenance-style")) return;
    const style = document.createElement("style");
    style.id = "rekabetli-maintenance-style";
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function lockDocument() {
    document.documentElement.classList.add("rek-maintenance-lock");
    document.title = "Site düzenleniyor | rekabetli.com";
  }

  function mountOverlay() {
    if (document.getElementById("rekabetli-maintenance")) return;
    const root = document.createElement("div");
    root.id = "rekabetli-maintenance";
    root.innerHTML = `
      <div class="rek-maintenance" role="alertdialog" aria-modal="true" aria-labelledby="rek-maintenance-title" aria-describedby="rek-maintenance-text">
        <div class="rek-maintenance-card">
          <img class="rek-maintenance-logo" src="/assets/rekabetli.png" alt="rekabetli.com" />
          <p class="rek-maintenance-badge">Bakım çalışması</p>
          <h1 id="rek-maintenance-title" class="rek-maintenance-title">Site şu anda düzenleniyor</h1>
          <p id="rek-maintenance-text" class="rek-maintenance-text">
            Kısa süreli bir bakım nedeniyle rekabetli.com geçici olarak kapalı.
            Çok yakında yeniden hizmetinizdeyiz.
          </p>
          <p class="rek-maintenance-date">
            <span>Tahmini açılış</span>
            <strong>${REOPEN_LABEL}</strong>
          </p>
          <p class="rek-maintenance-note">
            Anlayışınız için teşekkür ederiz.<br />
            Sorularınız için
            <a href="mailto:info@rekabetli.com">info@rekabetli.com</a>
          </p>
        </div>
      </div>`;
    document.body.appendChild(root);

    const rest = [...document.body.children].filter((el) => el !== root);
    rest.forEach((el) => {
      if ("inert" in el) el.inert = true;
      el.setAttribute("aria-hidden", "true");
    });
  }

  function blockBrowseKeys(event) {
    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  injectStyles();
  lockDocument();
  document.addEventListener("keydown", blockBrowseKeys, true);

  if (document.body) mountOverlay();
  else document.addEventListener("DOMContentLoaded", mountOverlay);
})();
