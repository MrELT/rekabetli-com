export type NotalPlanSource = "planner" | "manual" | "google";

export type NotalPlanBlock = {
  id: string;
  user_id: string;
  start_at: string;
  end_at: string;
  title: string;
  notes: string;
  source: NotalPlanSource;
  google_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type NotalPlanBlockInput = {
  start_at: string;
  end_at: string;
  title: string;
  notes?: string;
  source?: NotalPlanSource;
  google_event_id?: string | null;
};

export const NOTAL_TZ = "Europe/Istanbul";
