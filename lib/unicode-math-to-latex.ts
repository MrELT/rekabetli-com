/** Dikey birleştirilmiş ASCII/Unicode formülü KaTeX-dostu LaTeX'e yaklaştırır */
export function unicodeMathToLatex(body: string): string {
  if (/\\[a-zA-Z]{2,}/.test(body)) return body;

  let s = body.replace(/\u200b|\u00ad/g, "");

  s = s
    .replace(/π/g, "\\pi ")
    .replace(/ρ/g, "\\rho ")
    .replace(/Ω/g, "\\Omega ")
    .replace(/Φ/g, "\\Phi ")
    .replace(/∇/g, "\\nabla ")
    .replace(/∝/g, "\\propto ")
    .replace(/∫/g, "\\int ")
    .replace(/≤/g, "\\leq ")
    .replace(/≥/g, "\\geq ")
    .replace(/≈/g, "\\approx ")
    .replace(/·/g, "\\cdot ")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/₁/g, "_1")
    .replace(/₂/g, "_2")
    .replace(/​/g, "");

  s = s.replace(/(\d)([a-zA-Zπρ])/g, "$1 $2");
  s = s.replace(/([a-zA-Zπρ])(\d)/g, (m, letter, digit, offset, full) => {
    const before = full[offset - 1];
    if (before && /[a-zA-Z]/.test(before)) return m;
    return `${letter}^{${digit}}`;
  });

  return s.replace(/\s{2,}/g, " ").trim();
}
