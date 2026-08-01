export type CommitteeVeto = "none" | "soft" | "hard";

export type SpecialistRole = "pdr" | "exam";

/** Uzman ajanın sabit şema çıktısı (1 tur, kısa). */
export type SpecialistOpinion = {
  role: SpecialistRole;
  risks: string[];
  suggestions: string[];
  veto: CommitteeVeto;
  vetoReason: string;
};

export type PlanCommitteeBrief = {
  request: string;
  studentSummary: string;
  calendarSummary: string;
  performanceSummary: string;
};

/** Komite yalnız uzman görüşü toplar; nihai karar orkestratördedir. */
export type PlanCommitteeResult = {
  ok: boolean;
  brief: PlanCommitteeBrief | null;
  specialists: {
    pdr: SpecialistOpinion;
    exam: SpecialistOpinion;
  };
  hasHardVeto: boolean;
  error?: string;
};
