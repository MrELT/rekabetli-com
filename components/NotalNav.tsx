"use client";

import { useCallback, useEffect, useState } from "react";

function go(href: string) {
  window.location.href = href;
}

export default function NotalNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobile();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, closeMobile]);

  return (
    <>
      <nav className="top-menu" aria-label="Üst menü">
        <div className="menu-actions">
          <a className="menu-btn" href="/kimler-icin#ogrenciler">
            Öğrenciler
          </a>
          <a className="menu-btn" href="/kimler-icin#ogretmenler">
            Öğretmenler
          </a>
          <a className="menu-btn" href="/kimler-icin#mentorler">
            Mentörler
          </a>
          <a className="menu-btn" href="/kimler-icin#veliler">
            Veliler
          </a>
          <a className="menu-btn menu-btn-about" href="/hakkimizda">
            Hakkımızda
          </a>
        </div>
      </nav>

      <nav className="top-nav" aria-label="Ana menü">
        <a className="brand" href="/">
          <img
            src="/assets/rekabetli.png"
            alt="Rekabetli"
            className="brand-logo"
          />
        </a>
        <button
          id="open-mobile-menu"
          className="menu-toggle"
          type="button"
          aria-label="Menüyü aç"
          onClick={openMobile}
        >
          ☰
        </button>
        <div className="nav-actions">
          <a className="nav-btn nav-btn-notal" href="/notal" aria-label="NotAl — Not Al, Not AI">
            <span className="notal-mark">
              <span className="notal-word-not">Not</span>
              <span className="notal-word-al">Al</span>
            </span>
          </a>
          <a className="nav-btn" href="/notal/notlar">
            Notlarım
          </a>
          <button
            className="nav-btn"
            type="button"
            onClick={() => go("/communities")}
          >
            Topluluklar
          </button>
          <button
            className="nav-btn"
            type="button"
            onClick={() => go("/competitions")}
          >
            Yarışmalar
          </button>
          <button
            className="nav-btn"
            type="button"
            onClick={() => go("/exams")}
          >
            Sınavlar
          </button>
          <button
            className="nav-btn"
            type="button"
            onClick={() => go("/mentors")}
          >
            Mentörüm
          </button>
          <div className="notifications-wrap">
            <button
              id="notifications-btn"
              className="nav-btn notifications-btn"
              type="button"
              aria-label="Bildirimler"
              hidden
            >
              🔔
              <span id="notifications-badge" className="notifications-badge" hidden>
                0
              </span>
            </button>
            <div id="notifications-popup" className="notifications-popup" hidden>
              <div className="notifications-popup-header">
                <strong>Bildirimler</strong>
                <button
                  id="close-notifications"
                  type="button"
                  className="icon-btn"
                  aria-label="Kapat"
                >
                  ✕
                </button>
              </div>
              <ul id="notifications-list" className="notifications-list" />
              <p id="notifications-empty" className="empty notifications-empty">
                Bildirim yok.
              </p>
            </div>
          </div>
          <a
            id="desktop-profile-btn"
            className="nav-btn profile-link"
            href="/login"
          >
            Giriş Yap
          </a>
        </div>
      </nav>

      <div
        id="mobile-menu"
        className="mobile-menu-overlay"
        hidden={!mobileOpen}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeMobile();
        }}
      >
        <section
          className="mobile-menu-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Mobil menu"
        >
          <div className="mobile-menu-header">
            <strong>Menü</strong>
            <button
              id="close-mobile-menu"
              type="button"
              className="icon-btn"
              aria-label="Menüyü kapat"
              onClick={closeMobile}
            >
              ✕
            </button>
          </div>
          <div className="mobile-menu-actions">
            <a className="nav-btn" href="/hakkimizda">
              Hakkımızda
            </a>
            <a
              className="nav-btn nav-btn-notal"
              href="/notal"
              aria-label="NotAl — Not Al, Not AI"
            >
              <span className="notal-mark">
                <span className="notal-word-not">Not</span>
                <span className="notal-word-al">Al</span>
              </span>
            </a>
            <a className="nav-btn" href="/notal/notlar">
              Notlarım
            </a>
            <button
              className="nav-btn"
              type="button"
              onClick={() => go("/communities")}
            >
              Topluluklar
            </button>
            <button
              className="nav-btn"
              type="button"
              onClick={() => go("/competitions")}
            >
              Yarışmalar
            </button>
            <button
              className="nav-btn"
              type="button"
              onClick={() => go("/exams")}
            >
              Sınavlar
            </button>
            <button
              className="nav-btn"
              type="button"
              onClick={() => go("/mentors")}
            >
              Mentörüm
            </button>
            <button
              id="mobile-notifications-btn"
              className="nav-btn notifications-btn"
              type="button"
              hidden
            >
              🔔 Bildirimler
            </button>
            <a
              id="mobile-profile-btn"
              className="nav-btn profile-link"
              href="/login"
            >
              Giriş Yap
            </a>
          </div>
        </section>
      </div>
    </>
  );
}
