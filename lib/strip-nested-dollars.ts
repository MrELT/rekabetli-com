/**
 * LaTeX içine yanlışlıkla giren $ işaretleri (yalnızca güvenli kalıplar).
 */

export function stripDollarsInsideLatex(text: string): string {
  let out = text;

  out = out.replace(
    /\\(ddot|dot|vec|hat|bar)\{\s*\$([^$]*)\$\s*\}/g,
    "\\$1{$2}",
  );

  out = out.replace(/_\{\s*\$([^$]*)\$\s*\}/g, "_{$1}");

  out = out.replace(
    /\$\s*(\\(?:mathbf|boldsymbol|mathrm|mathit|mathcal|mathbb)(?:\{[^{}]*\}|\([^)]*\))+)\s*\$/g,
    "$1",
  );

  out = out.replace(/\{\s*\$([^$]*)\$\s*\}/g, (_, inner) => {
    const t = inner.trim();
    if (t.startsWith("\\")) return `{${t}}`;
    return `{${t}}`;
  });

  return out;
}
