(function initRekabetliSecurity() {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isSafeHttpUrl(url) {
    const raw = String(url ?? "").trim();
    if (!raw) return false;
    try {
      const parsed = new URL(raw, window.location.href);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  function isSafeBlobUrl(url) {
    const raw = String(url ?? "").trim();
    return raw.startsWith("blob:");
  }

  function setImgSrc(img, url, options = {}) {
    if (!img) return false;
    const raw = String(url ?? "").trim();
    const allowBlob = Boolean(options.allowBlob);
    if (raw && (isSafeHttpUrl(raw) || (allowBlob && isSafeBlobUrl(raw)))) {
      img.src = raw;
      return true;
    }
    img.removeAttribute("src");
    return false;
  }

  function appendEmptyMessage(parent, text, className = "empty") {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    parent.appendChild(p);
    return p;
  }

  const MARKUP_OR_SCRIPT_PATTERN = /<[^>]+>|javascript\s*:|data\s*:|vbscript\s*:|on\w+\s*=/i;
  const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

  function stripControlChars(value) {
    return String(value ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  }

  function stripHtmlTags(value) {
    return String(value ?? "").replace(/<[^>]*>/g, "");
  }

  function isValidUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(value ?? "").trim(),
    );
  }

  /** Vitrin paket/branş öğe kimlikleri (UUID veya güvenli kısa id). */
  function sanitizePackageId(value) {
    const id = String(value ?? "").trim();
    if (!id || id.length > 64) return "";
    if (isValidUuid(id)) return id;
    if (/^[a-zA-Z0-9_-]+$/.test(id)) return id;
    return "";
  }

  function sanitizeMultilinePlainText(value, maxLength = 3000) {
    let text = stripControlChars(stripHtmlTags(value));
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    text = text
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
      .join("\n")
      .trim();
    if (maxLength > 0 && text.length > maxLength) {
      text = text.slice(0, maxLength);
    }
    return text;
  }

  /** Düz metin alanları: HTML etiketleri ve kontrol karakterleri temizlenir. */
  function sanitizePlainText(value, maxLength = 500) {
    let text = stripControlChars(stripHtmlTags(value));
    text = text.replace(/\s+/g, " ").trim();
    if (maxLength > 0 && text.length > maxLength) {
      text = text.slice(0, maxLength);
    }
    return text;
  }

  function containsMarkupAttempt(value) {
    return MARKUP_OR_SCRIPT_PATTERN.test(String(value ?? ""));
  }

  function sanitizePersonName(value, maxLength = 80) {
    let text = sanitizePlainText(value, maxLength);
    text = text.replace(/[^\p{L}\p{M}'\-. ]+/gu, " ").replace(/\s+/g, " ").trim();
    if (maxLength > 0 && text.length > maxLength) {
      text = text.slice(0, maxLength);
    }
    return text;
  }

  function sanitizeEmail(value, maxLength = 120) {
    let text = sanitizePlainText(value, maxLength).toLowerCase();
    if (/^(javascript|data|vbscript):/i.test(text)) return "";
    return text;
  }

  function isValidEmail(value) {
    const email = sanitizeEmail(value, 120);
    return Boolean(email) && EMAIL_PATTERN.test(email);
  }

  function sanitizePhone(value, maxLength = 20) {
    let text = stripControlChars(stripHtmlTags(value));
    text = text.replace(/[^\d+() \-]/g, "").trim();
    if (maxLength > 0 && text.length > maxLength) {
      text = text.slice(0, maxLength);
    }
    return text;
  }

  /** Mentörlük / talep branşı metinleri. */
  function sanitizeBranchText(value, maxLength = 120) {
    let text = sanitizePlainText(value, maxLength);
    if (/^(javascript|data|vbscript):/i.test(text)) return "";
    return text;
  }

  function sanitizeBranchList(branches, maxItems = 8, maxItemLength = 120) {
    const seen = new Set();
    const result = [];
    for (const raw of branches) {
      const item = sanitizeBranchText(raw, maxItemLength);
      if (!item) continue;
      const key = item.toLocaleLowerCase("tr-TR");
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
      if (result.length >= maxItems) break;
    }
    return result;
  }

  window.RekabetliSecurity = {
    escapeHtml,
    isSafeHttpUrl,
    isValidUuid,
    setImgSrc,
    appendEmptyMessage,
    sanitizePlainText,
    sanitizeMultilinePlainText,
    sanitizePersonName,
    sanitizeEmail,
    sanitizePhone,
    sanitizeBranchText,
    sanitizeBranchList,
    sanitizePackageId,
    isValidEmail,
    containsMarkupAttempt,
  };
})();
