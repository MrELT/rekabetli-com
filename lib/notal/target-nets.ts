import type { YksArea } from "@/lib/notal/student-context";

export type TargetNetEstimate = {
  rank: number;
  area: YksArea;
  /** Performans hesabında kullanılan aralık orta noktası. */
  tytNet: number;
  aytNet: number | null;
  ydtNet: number | null;
  tytRange: [number, number];
  aytRange: [number, number] | null;
  ydtRange: [number, number] | null;
};

type NetAnchor = {
  rank: number;
  tyt: [number, number];
  ayt?: [number, number];
  ydt?: [number, number];
};

/**
 * Kullanıcının verdiği ortalama hedef aralıkları.
 * Ara sıralamalar logaritmik interpolasyonla tahmin edilir.
 */
const ANCHORS: Record<YksArea, NetAnchor[]> = {
  Sayısal: [
    { rank: 100, tyt: [115, 118], ayt: [78, 80] },
    { rank: 1_000, tyt: [110, 112], ayt: [75, 77] },
    { rank: 5_000, tyt: [105, 108], ayt: [70, 73] },
    { rank: 10_000, tyt: [100, 105], ayt: [66, 69] },
    { rank: 15_000, tyt: [95, 100], ayt: [63, 65] },
    { rank: 50_000, tyt: [85, 90], ayt: [50, 55] },
  ],
  "Eşit Ağırlık": [
    { rank: 100, tyt: [110, 115], ayt: [76, 78] },
    { rank: 1_000, tyt: [100, 105], ayt: [70, 73] },
    { rank: 5_000, tyt: [95, 98], ayt: [63, 66] },
    { rank: 10_000, tyt: [90, 93], ayt: [58, 62] },
    { rank: 15_000, tyt: [85, 88], ayt: [55, 58] },
    { rank: 50_000, tyt: [70, 75], ayt: [43, 48] },
  ],
  Sözel: [
    { rank: 100, tyt: [100, 105], ayt: [76, 78] },
    { rank: 1_000, tyt: [90, 95], ayt: [72, 74] },
    { rank: 5_000, tyt: [82, 87], ayt: [65, 68] },
    { rank: 10_000, tyt: [75, 80], ayt: [62, 65] },
    { rank: 15_000, tyt: [72, 75], ayt: [58, 62] },
    { rank: 50_000, tyt: [60, 65], ayt: [50, 54] },
  ],
  // Dil için yeni tablo verilmediğinden mevcut yaklaşık rehber korunur.
  Dil: [
    { rank: 500, tyt: [88, 92], ydt: [73, 77] },
    { rank: 2_000, tyt: [78, 82], ydt: [63, 67] },
    { rank: 10_000, tyt: [68, 72], ydt: [53, 57] },
    { rank: 30_000, tyt: [58, 62], ydt: [43, 47] },
    { rank: 80_000, tyt: [48, 52], ydt: [33, 37] },
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

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function interpolateRange(
  anchors: NetAnchor[],
  rank: number,
  key: "tyt" | "ayt" | "ydt",
): [number, number] | null {
  const points = anchors
    .map((a) => {
      const value = a[key];
      return value === undefined ? null : { rank: a.rank, value };
    })
    .filter(
      (p): p is { rank: number; value: [number, number] } => p !== null,
    );

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
      return [
        roundHalf(lerp(lo.value[0], hi.value[0], t)),
        roundHalf(lerp(lo.value[1], hi.value[1], t)),
      ];
    }
  }

  return last.value;
}

function midpoint(range: [number, number] | null): number | null {
  if (!range) return null;
  return roundHalf((range[0] + range[1]) / 2);
}

export function estimateTargetNets(
  targetRank: string | null | undefined,
  area: YksArea | null | undefined,
): TargetNetEstimate | null {
  if (!area) return null;
  const rank = parseTargetRank(targetRank);
  if (!rank) return null;

  const anchors = ANCHORS[area];
  const tytRange = interpolateRange(anchors, rank, "tyt");
  if (tytRange === null) return null;

  const aytRange =
    area === "Dil" ? null : interpolateRange(anchors, rank, "ayt");
  const ydtRange =
    area === "Dil" ? interpolateRange(anchors, rank, "ydt") : null;

  return {
    rank,
    area,
    tytNet: midpoint(tytRange)!,
    aytNet: midpoint(aytRange),
    ydtNet: midpoint(ydtRange),
    tytRange,
    aytRange,
    ydtRange,
  };
}

function formatRange(range: [number, number]): string {
  return range[0] === range[1]
    ? String(range[0])
    : `${range[0]}–${range[1]}`;
}

export function formatTargetNetSummary(estimate: TargetNetEstimate): string {
  const parts = [`TYT ${formatRange(estimate.tytRange)}`];
  if (estimate.aytRange !== null) {
    parts.push(`AYT ${formatRange(estimate.aytRange)}`);
  }
  if (estimate.ydtRange !== null) {
    parts.push(`YDT ${formatRange(estimate.ydtRange)}`);
  }
  return parts.join(" · ");
}

export function formatTargetNetHint(estimate: TargetNetEstimate): string {
  return `${estimate.area} · Ortalama tahmin: ${formatTargetNetSummary(estimate)}. Sınavın zorluğuna göre değişebilir.`;
}
