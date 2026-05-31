/**
 * $ olmadan yapışık LaTeX + Türkçe metin (örn. U_{\\text{eff}}=... Burada \\Omegasistemin...)
 */

const RAW_LATEX_MARKERS =
  /\\(?:frac|text|mathbf|boldsymbol|mathrm|mathit|mathcal|mathbb|ddot|dot|Omega|rho|theta|sigma|alpha|beta|mu|nu|pi|phi|left|right|cdot|sqrt|sum|int)/;

const PROSE_START =
  /\s+(Burada|Dolayısıyla|Bu noktada|Bu iki|Sonuç olarak|Geometrik analizle|Lagrange noktaları|Newton|Sistem|Bunun|Kütle|Toplam|şeklinde)/iu;

const GREEK_IN_PROSE =
  /\\(Omega|rho|theta|sigma|alpha|beta|mu|nu|pi|phi|psi|Gamma|Delta|lambda)(?=[a-züğışöçA-ZİĞÜŞÖÇ])/gi;

function formatDisplayBlock(latex: string): string {
  const body = latex.trim();
  if (!body) return "";
  return "\n$$\n" + body + "\n$$\n";
}

/** Türkçe cümle içindeki yapışık \\Omega, \\rho vb. */
export function fixProseLatexGlitches(text: string): string {
  let out = text;

  out = out.replace(GREEK_IN_PROSE, (_, cmd) => `$\\${cmd}$ `);

  out = out.replace(
    /\bve\s*\\(rho|Omega|theta|sigma)\b/gi,
    (_, sym) => `ve $\\${sym}$`,
  );

  out = out.replace(/\b([a-züğışöç]+)\\(rho|Omega)\b/gi, (_, word, sym) => {
    return `${word} $\\${sym}$`;
  });

  return out;
}

function looksLikeRawLatex(segment: string): boolean {
  if (segment.includes("$")) return false;
  return (
    RAW_LATEX_MARKERS.test(segment) ||
    /\\frac|_\{|\\text\{|\\Omega|\\rho|\^[0-9{]/.test(segment)
  );
}

/** Satır veya paragraf: ham formül + "Burada ..." */
export function splitGluedLatexAndProse(text: string): string {
  let out = text;

  let inDisplay = false;
  out = out
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === "$$") {
        inDisplay = !inDisplay;
        return line;
      }
      if (inDisplay || !trimmed || trimmed.includes("$$")) return line;

      const match = trimmed.match(/^(.+?)\s+(Burada\s.+)$/iu);
      if (match) {
        const latexPart = match[1].trim();
        const prosePart = match[2].trim();
        if (looksLikeRawLatex(latexPart)) {
          return `${formatDisplayBlock(latexPart)}\n\n${fixProseLatexGlitches(prosePart)}`;
        }
      }

      const wide = trimmed.match(
        /^(.+\\(?:frac|text|Omega|rho|mathbf|boldsymbol|ddot|dot)[^$]{8,}?)\s+([A-ZÇĞİÖŞÜ"D][^$]*)$/u,
      );
      if (wide) {
        const latexPart = wide[1].trim();
        const prosePart = wide[2].trim();
        if (looksLikeRawLatex(latexPart) && !looksLikeRawLatex(prosePart)) {
          return `${formatDisplayBlock(latexPart)}\n\n${fixProseLatexGlitches(prosePart)}`;
        }
      }

      if (looksLikeRawLatex(trimmed) && !PROSE_START.test(trimmed)) {
        return formatDisplayBlock(trimmed);
      }

      return line;
    })
    .join("\n");

  return out;
}

/** Yaygın LaTeX sembolleri → öğrencinin göreceği Unicode karakter */
const LATEX_SYMBOL_GLYPH: Record<string, string> = {
  Omega: "Ω",
  rho: "ρ",
  theta: "θ",
  sigma: "σ",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  mu: "μ",
  nu: "ν",
  pi: "π",
  phi: "φ",
  psi: "ψ",
  Gamma: "Γ",
  Delta: "Δ",
  lambda: "λ",
  tau: "τ",
  epsilon: "ε",
};

/** $\Omega$ → Ω (liste ve sözlük satırları için) */
export function latexInlineToVisibleGlyph(sym: string): string | null {
  const inner = sym
    .replace(/^\$+|\$+$/g, "")
    .trim()
    .replace(/^\\+/, "");
  return LATEX_SYMBOL_GLYPH[inner] ?? null;
}

function formatSymbolListItem(sym: string, description: string): string {
  const desc = description.replace(/\s*(dır|dir|tır|tir)\s*$/i, "").trim();
  const glyph = latexInlineToVisibleGlyph(sym);
  if (glyph) {
    return `- **${glyph}** — ${desc}`;
  }
  return `- ${sym} — ${desc}`;
}

/**
 * Formül bloğundan sonraki "Burada ..." cümlelerini okunaklı paragraflara/listelere çevirir.
 */
export function improveNotAlReadability(text: string): string {
  let out = text;

  // Yalnızca formül satırı; bitişik $$\n\n$$ bloklarını bozma
  out = out.replace(/\n\$\$\n(?!\s*\$\$)(\\[^\n]+)/g, "\n$$\n\n$1");

  out = out.replace(
    /Burada\s+(\$[^$\n]+\$)\s+(.+?)\s+ve\s+(\$[^$\n]+\$)\s+(.+?)\./giu,
    (_, sym1, desc1, sym2, desc2) => {
      const d1 = desc1.trim();
      const d2 = desc2.trim();
      return `**Semboller:**\n\n${formatSymbolListItem(sym1, d1)}\n${formatSymbolListItem(sym2, d2)}.`;
    },
  );

  out = out.replace(
    /^Burada\s+(\$[^$\n]+\$)\s+(.+?)\./gimu,
    (_, sym, desc) => `${formatSymbolListItem(sym, desc.trim())}.`,
  );

  // Zaten oluşmuş "- $\Omega$: açıklama" satırlarını düzelt
  out = out.replace(
    /^- (\$[^$\n]+\$)\s*:\s*(.+)$/gimu,
    (_, sym, desc) => formatSymbolListItem(sym, desc),
  );

  out = out.replace(
    /\.\s+(Lagrange|Sonuç olarak|Bu noktada|Etkin|Önemli|Dikkat|Not:|Unutma)/giu,
    ".\n\n$1",
  );

  out = out.replace(
    /([a-züğışöç])\.\s+([A-ZÇĞİÖŞÜ][a-züğışöç]{3,})/gu,
    "$1.\n\n$2",
  );

  return out.replace(/\n{3,}/g, "\n\n");
}
