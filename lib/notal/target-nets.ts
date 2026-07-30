import type { YksArea } from "@/lib/notal/student-context";

/** Önceki yıl (2025 YKS) net–sıralama referansı. */
export const TARGET_NET_REFERENCE_YEAR = 2025;

export type TargetNetEstimate = {
  referenceYear: number;
  rank: number;
  area: YksArea;
  tytNet: number;
  aytNet: number | null;
  ydtNet: number | null;
};

type NetAnchor = {
  rank: number;
  tyt: number;
  ayt?: number;
  ydt?: number;
};

/**
 * 2024–2025 YKS verilerine dayanan yaklaşık net hedefleri.
 * Kesin sıralama sınav zorluğuna göre değişir; rehber amaçlıdır.
 */
const ANCHORS: Record<YksArea, NetAnchor[]> = {
  Sayısal: [
    { rank: 500, tyt: 105, ayt: 75 },
    { rank: 2_000, tyt: 100, ayt: 70 },
    { rank: 10_000, tyt: 90, ayt: 60 },
    { rank: 37_500, tyt: 80, ayt: 50 },
    { rank: 115_000, tyt: 70, ayt: 40 },
    { rank: 275_000, tyt: 60, ayt: 30 },
    { rank: 500_000, tyt: 50, ayt: 22 },
  ],
  "Eşit Ağırlık": [
    { rank: 500, tyt: 100, ayt: 70 },
    { rank: 2_000, tyt: 95, ayt: 65 },
    { rank: 10_000, tyt: 85, ayt: 55 },
    { rank: 45_000, tyt: 75, ayt: 45 },
    { rank: 150_000, tyt: 65, ayt: 35 },
    { rank: 350_000, tyt: 55, ayt: 25 },
  ],
  Sözel: [
    { rank: 500, tyt: 100, ayt: 75 },
    { rank: 3_000, tyt: 90, ayt: 65 },
    { rank: 20_000, tyt: 80, ayt: 55 },
    { rank: 75_000, tyt: 70, ayt: 45 },
    { rank: 200_000, tyt: 60, ayt: 35 },
    { rank: 400_000, tyt: 50, ayt: 25 },
  ],
  Dil: [
    { rank: 500, tyt: 90, ydt: 75 },
    { rank: 2_000, tyt: 80, ydt: 65 },
    { rank: 10_000, tyt: 70, ydt: 55 },
    { rank: 30_000, tyt: 60, ydt: 45 },
    { rank: 80_000, tyt: 50, ydt: 35 },
  ],
};

/** "İlk 10.000", "5000", "50 bin" gibi ifadelerden sıra sayısı çıkarır. */
export function parseTargetRank(input: string | null | undefined): number | null {
  if (!input?.trim()) return null;
  const raw = input.trim().toLowerCase().replace(/ı/g, "i");

  const binMatch = raw.match(
    /(\d+(?:[.,]\d+)?)\s*(?:bin|k\b)/i,
  );
  if (binMatch) {
    const n = Number(binMatch[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  }

  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const rank = Number(digits);
  if (!Number.isFinite(rank) || rank <= 0) return null;
  return rank;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateNet(
  anchors: NetAnchor[],
  rank: number,
  key: "tyt" | "ayt" | "ydt",
): number | null {
  const points = anchors
    .map((a) => {
      const value = a[key];
      return value === undefined ? null : { rank: a.rank, value };
    })
    .filter((p): p is { rank: number; value: number } => Boolean(p));

  if (!points.length) return null;

  if (rank <= points[0].rank) return points[0].value;
  const last = points[points.length - 1];
  if (rank >= last.rank) return last.value;

  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i];
    const hi = points[i + 1];
    if (rank >= lo.rank && rank <= hi.rank) {
      const t =
        (Math.log(rank) - Math.log(lo.rank)) /
        (Math.log(hi.rank) - Math.log(lo.rank));
      return Math.round(lerp(lo.value, hi.value, t));
    }
  }

  return last.value;
}

export function estimateTargetNets(
  targetRank: string | null | undefined,
  area: YksArea | null | undefined,
): TargetNetEstimate | null {
  if (!area) return null;
  const rank = parseTargetRank(targetRank);
  if (!rank) return null;

  const anchors = ANCHORS[area];
  const tytNet = interpolateNet(anchors, rank, "tyt");
  if (tytNet === null) return null;

  const aytNet = area === "Dil" ? null : interpolateNet(anchors, rank, "ayt");
  const ydtNet = area === "Dil" ? interpolateNet(anchors, rank, "ydt") : null;

  return {
    referenceYear: TARGET_NET_REFERENCE_YEAR,
    rank,
    area,
    tytNet,
    aytNet,
    ydtNet,
  };
}

export function formatTargetNetSummary(estimate: TargetNetEstimate): string {
  const parts = [`TYT ~${estimate.tytNet}`];
  if (estimate.aytNet !== null) parts.push(`AYT ~${estimate.aytNet}`);
  if (estimate.ydtNet !== null) parts.push(`YDT ~${estimate.ydtNet}`);
  return parts.join(" · ");
}

export function formatTargetNetHint(estimate: TargetNetEstimate): string {
  return `${estimate.area} · ${estimate.referenceYear} verisine göre ortalama ${formatTargetNetSummary(estimate)}`;
}
