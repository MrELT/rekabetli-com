export interface NotalNoteFeedbackSummary {
  ratingAvg: number | null;
  ratingCount: number;
  myScore: number | null;
  myComment: string | null;
}

export function formatRatingAvg(avg: number | null): string {
  if (avg == null || Number.isNaN(avg)) return "—";
  return (Math.round(avg * 10) / 10).toLocaleString("tr-TR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
