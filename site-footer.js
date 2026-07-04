(function initSiteFooter() {
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
  inner.append(brand, nav);

  const copy = document.createElement("p");
  copy.className = "site-footer-copy";
  copy.textContent = `© ${new Date().getFullYear()} rekabetli.com · ELT Technologies LTD`;

  footer.append(inner, copy);
  document.body.appendChild(footer);
})();
