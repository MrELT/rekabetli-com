/**
 * Türkiye'deki yaygın bankaların 5 haneli EFT / IBAN banka kodları.
 * IBAN içinde TR + 2 kontrol hanesinden sonraki 5 hanedir.
 */
export const BANK_CODES: Record<string, string> = {
  "00010": "T.C. Ziraat Bankası",
  "00012": "Türkiye Halk Bankası (Halkbank)",
  "00015": "Türkiye Vakıflar Bankası (VakıfBank)",
  "00032": "Türk Ekonomi Bankası (TEB)",
  "00046": "Akbank",
  "00059": "Şekerbank",
  "00062": "Garanti BBVA",
  "00064": "Türkiye İş Bankası",
  "00067": "Yapı ve Kredi Bankası",
  "00092": "Citibank",
  "00099": "ING Bank",
  "00103": "Fibabanka",
  "00109": "ICBC Turkey Bank",
  "00111": "QNB Finansbank / Enpara",
  "00123": "HSBC",
  "00134": "DenizBank",
  "00135": "Anadolubank",
  "00146": "Odeabank",
  "00203": "Albaraka Türk",
  "00205": "Kuveyt Türk",
  "00206": "Türkiye Finans",
  "00209": "Ziraat Katılım",
  "00210": "Vakıf Katılım",
  "00211": "Emlak Katılım",
};

const TURKISH_IBAN_MAX_LENGTH = 26;

/** Boşluksuz, büyük harf, en fazla 26 karakter. */
export function compactTurkishIban(value: string): string {
  let compact = String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (compact && !compact.startsWith("T") && /^\d/.test(compact)) {
    compact = `TR${compact}`;
  }

  return compact.slice(0, TURKISH_IBAN_MAX_LENGTH);
}

/**
 * Görüntü formatı: TR XX XXXX XXXX XXXX XXXX XXXX XX
 */
export function formatTurkishIbanInput(value: string): string {
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

/** TR + 2 kontrol hanesinden sonraki 5 haneli banka kodu. */
export function extractTurkishBankCode(value: string): string | null {
  const compact = compactTurkishIban(value);
  if (compact.length < 9 || !compact.startsWith("TR")) return null;
  return compact.slice(4, 9);
}

export function resolveTurkishBankName(value: string): string | null {
  const code = extractTurkishBankCode(value);
  if (!code) return null;
  return BANK_CODES[code] ?? null;
}

export function resolveTurkishBankLabel(value: string): string | null {
  const code = extractTurkishBankCode(value);
  if (!code) return null;
  const known = BANK_CODES[code];
  if (known) return known;
  if (compactTurkishIban(value).length >= 9) {
    return `Bilinmeyen banka (${code})`;
  }
  return null;
}
