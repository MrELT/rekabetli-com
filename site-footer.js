const AUDIENCE_LINKS = [
  { href: "/kimler-icin#ogrenciler", label: "Öğrenciler" },
  { href: "/kimler-icin#ogretmenler", label: "Öğretmenler" },
  { href: "/kimler-icin#mentorler", label: "Mentörler" },
  { href: "/kimler-icin#veliler", label: "Veliler" },
  { href: "/influencer-program", label: "Influencer Programı" },
  { href: "/hakkimizda", label: "Hakkımızda" },
];

function injectMobileAudienceNav() {
  const container = document.querySelector(".mobile-menu-actions");
  if (!container) return;

  [...container.querySelectorAll(":scope > a.nav-btn")].forEach((anchor) => {
    const href = (anchor.getAttribute("href") || "").split("?")[0];
    if (href.startsWith("/kimler-icin#") || href === "/kimler-icin") {
      anchor.remove();
    }
  });

  const kimlerIcin = document.createElement("a");
  kimlerIcin.className = "nav-btn";
  kimlerIcin.href = "/kimler-icin";
  kimlerIcin.textContent = "Kimin için";

  const profileBtn = container.querySelector("#mobile-profile-btn");
  if (profileBtn) {
    container.insertBefore(kimlerIcin, profileBtn);
  } else {
    container.appendChild(kimlerIcin);
  }
}

(function initSiteFooter() {
  if (!window.RekabetliCookieConsent && !document.querySelector('script[data-rekabetli-cookie-consent="1"]')) {
    const consentScript = document.createElement("script");
    consentScript.src = "/cookie-consent.js";
    consentScript.dataset.rekabetliCookieConsent = "1";
    consentScript.defer = true;
    document.head.appendChild(consentScript);
  }

  if (!window.RekabetliReferral && !document.querySelector('script[data-rekabetli-referral="1"]')) {
    const referralScript = document.createElement("script");
    referralScript.src = "/referral-tracking.js";
    referralScript.dataset.rekabetliReferral = "1";
    referralScript.defer = true;
    document.head.appendChild(referralScript);
  }

  injectMobileAudienceNav();

  if (document.querySelector(".site-footer")) return;

  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.setAttribute("role", "contentinfo");

  const inner = document.createElement("div");
  inner.className = "site-footer-inner";

  const brand = document.createElement("div");
  brand.className = "site-footer-brand";

  const description = document.createElement("p");
  description.className = "site-footer-description";
  description.textContent =
    "rekabetli.com is an online educational marketplace connecting students with expert mentors for academic guidance.";

  const company = document.createElement("p");
  company.className = "site-footer-company";
  company.textContent = "Operated by ELT Technologies LTD (Company No: 17318502)";

  const support = document.createElement("p");
  support.className = "site-footer-support";
  support.append(
    document.createTextNode("Customer Support: "),
    Object.assign(document.createElement("a"), {
      href: "mailto:info@rekabetli.com",
      textContent: "info@rekabetli.com",
    }),
  );

  const address = document.createElement("address");
  address.className = "site-footer-address";
  address.innerHTML =
    "71-75 Shelton Street<br>Covent Garden<br>London<br>WC2H 9JQ<br>UNITED KINGDOM";

  brand.append(description, company, support, address);

  const nav = document.createElement("nav");
  nav.className = "site-footer-nav";
  nav.setAttribute("aria-label", "Legal and Support");

  const navTitle = document.createElement("p");
  navTitle.className = "site-footer-nav-title";
  navTitle.append(
    document.createTextNode("Legal & Support "),
    Object.assign(document.createElement("span"), {
      className: "site-footer-nav-title-tr",
      textContent: "· Yasal & Destek",
    }),
  );

  const list = document.createElement("ul");
  list.className = "site-footer-links";

  const links = [
    {
      href: "/terms-of-service",
      hrefTr: "/kullanim-kosullari",
      labelEn: "Terms of Service",
      labelTr: "Kullanım Koşulları",
    },
    {
      href: "/refund-policy",
      hrefTr: "/iptal-iade-politikasi",
      labelEn: "Cancellation & Refund Policy",
      labelTr: "İptal ve İade Politikası",
    },
    {
      href: "/contact",
      hrefTr: "/iletisim",
      labelEn: "Contact Us",
      labelTr: "İletişim",
    },
  ];

  links.forEach(({ href, hrefTr, labelEn, labelTr }) => {
    const item = document.createElement("li");
    item.className = "site-footer-link-item";

    const anchorEn = document.createElement("a");
    anchorEn.href = href;
    anchorEn.className = "site-footer-link-en";
    anchorEn.textContent = labelEn;

    const separator = document.createElement("span");
    separator.className = "site-footer-link-sep";
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "·";

    const anchorTr = document.createElement("a");
    anchorTr.href = hrefTr;
    anchorTr.className = "site-footer-link-tr";
    anchorTr.setAttribute("lang", "tr");
    anchorTr.textContent = labelTr;

    item.append(anchorEn, separator, anchorTr);
    list.appendChild(item);
  });

  nav.append(navTitle, list);

  const audienceNav = document.createElement("nav");
  audienceNav.className = "site-footer-nav site-footer-nav-audience";
  audienceNav.setAttribute("aria-label", "Kimler için");

  const audienceTitle = document.createElement("p");
  audienceTitle.className = "site-footer-nav-title";
  audienceTitle.textContent = "Kimler İçin";

  const audienceList = document.createElement("ul");
  audienceList.className = "site-footer-links";

  AUDIENCE_LINKS.forEach(({ href, label }) => {
    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.textContent = label;
    item.appendChild(anchor);
    audienceList.appendChild(item);
  });

  audienceNav.append(audienceTitle, audienceList);

  inner.append(brand, audienceNav, nav);

  const copy = document.createElement("p");
  copy.className = "site-footer-copy";
  copy.textContent = `© ${new Date().getFullYear()} rekabetli.com · ELT Technologies LTD`;

  footer.append(inner, copy);
  document.body.appendChild(footer);
})();
