"use strict";
var RekabetliTurkishBanks = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // lib/turkish-bank-codes.ts
  var turkish_bank_codes_exports = {};
  __export(turkish_bank_codes_exports, {
    BANK_CODES: () => BANK_CODES,
    compactTurkishIban: () => compactTurkishIban,
    extractTurkishBankCode: () => extractTurkishBankCode,
    formatTurkishIbanInput: () => formatTurkishIbanInput,
    resolveTurkishBankLabel: () => resolveTurkishBankLabel,
    resolveTurkishBankName: () => resolveTurkishBankName
  });
  var BANK_CODES = {
    "00010": "T.C. Ziraat Bankas\u0131",
    "00012": "T\xFCrkiye Halk Bankas\u0131 (Halkbank)",
    "00015": "T\xFCrkiye Vak\u0131flar Bankas\u0131 (Vak\u0131fBank)",
    "00032": "T\xFCrk Ekonomi Bankas\u0131 (TEB)",
    "00046": "Akbank",
    "00059": "\u015Eekerbank",
    "00062": "Garanti BBVA",
    "00064": "T\xFCrkiye \u0130\u015F Bankas\u0131",
    "00067": "Yap\u0131 ve Kredi Bankas\u0131",
    "00092": "Citibank",
    "00099": "ING Bank",
    "00103": "Fibabanka",
    "00109": "ICBC Turkey Bank",
    "00111": "QNB Finansbank / Enpara",
    "00123": "HSBC",
    "00134": "DenizBank",
    "00135": "Anadolubank",
    "00146": "Odeabank",
    "00203": "Albaraka T\xFCrk",
    "00205": "Kuveyt T\xFCrk",
    "00206": "T\xFCrkiye Finans",
    "00209": "Ziraat Kat\u0131l\u0131m",
    "00210": "Vak\u0131f Kat\u0131l\u0131m",
    "00211": "Emlak Kat\u0131l\u0131m"
  };
  var TURKISH_IBAN_MAX_LENGTH = 26;
  function compactTurkishIban(value) {
    let compact = String(value || "").replace(/\s+/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (compact && !compact.startsWith("T") && /^\d/.test(compact)) {
      compact = `TR${compact}`;
    }
    return compact.slice(0, TURKISH_IBAN_MAX_LENGTH);
  }
  function formatTurkishIbanInput(value) {
    const compact = compactTurkishIban(value);
    if (!compact) return "";
    if (compact.length <= 2) return compact;
    const country = compact.slice(0, 2);
    const afterCountry = compact.slice(2);
    if (!afterCountry) return country;
    const checkDigits = afterCountry.slice(0, 2);
    const body = afterCountry.slice(2);
    const bodyGroups = body.match(/.{1,4}/g) ?? [];
    let formatted = `${country} ${checkDigits}`;
    if (bodyGroups.length) {
      formatted += ` ${bodyGroups.join(" ")}`;
    }
    return formatted;
  }
  function extractTurkishBankCode(value) {
    const compact = compactTurkishIban(value);
    if (compact.length < 9 || !compact.startsWith("TR")) return null;
    return compact.slice(4, 9);
  }
  function resolveTurkishBankName(value) {
    const code = extractTurkishBankCode(value);
    if (!code) return null;
    return BANK_CODES[code] ?? null;
  }
  function resolveTurkishBankLabel(value) {
    const code = extractTurkishBankCode(value);
    if (!code) return null;
    const known = BANK_CODES[code];
    if (known) return known;
    if (compactTurkishIban(value).length >= 9) {
      return `Bilinmeyen banka (${code})`;
    }
    return null;
  }
  return __toCommonJS(turkish_bank_codes_exports);
})();
