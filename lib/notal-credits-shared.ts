export const NOTAL_NOTES_PER_GRANT = 3;
export const NOTAL_MAX_PDF_GRANTS = 5;

export interface NotalCreditsState {
  notesRemaining: number;
  notesMax: number;
  pdfGrantsUsed: number;
  pdfGrantsMax: number;
  canGenerate: boolean;
  canGrantFromPdf: boolean;
  grantLimitReached: boolean;
}

export function buildCreditsState(row: {
  notes_remaining: number;
  pdf_grant_count: number;
}): NotalCreditsState {
  const notesRemaining = Math.max(0, Math.min(NOTAL_NOTES_PER_GRANT, row.notes_remaining));
  const pdfGrantsUsed = Math.max(0, row.pdf_grant_count);
  const grantLimitReached = pdfGrantsUsed >= NOTAL_MAX_PDF_GRANTS;

  return {
    notesRemaining,
    notesMax: NOTAL_NOTES_PER_GRANT,
    pdfGrantsUsed,
    pdfGrantsMax: NOTAL_MAX_PDF_GRANTS,
    canGenerate: notesRemaining > 0,
    canGrantFromPdf: !grantLimitReached,
    grantLimitReached,
  };
}
