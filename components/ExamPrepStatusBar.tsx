"use client";

import {
  buildStepStatuses,
  EXAM_PREP_STATUS_PIPELINE,
  EXAM_PREP_STEP_LABELS,
  STUDY_STATUS_PIPELINE,
  STUDY_STEP_LABELS,
} from "@/lib/exam-prep/progress";

export interface StatusBarStep {
  id: string;
  label: string;
  status: "done" | "active" | "pending";
}

export interface ExamPrepStatusBarProps {
  label: string;
  percent: number;
  detail?: string;
  currentStep: string;
  completedSteps: string[];
  mode: "analyze" | "study";
}

export default function ExamPrepStatusBar({
  label,
  percent,
  detail,
  currentStep,
  completedSteps,
  mode,
}: ExamPrepStatusBarProps) {
  const pipeline =
    mode === "study" ? STUDY_STATUS_PIPELINE : EXAM_PREP_STATUS_PIPELINE;
  const labels =
    mode === "study" ? STUDY_STEP_LABELS : EXAM_PREP_STEP_LABELS;

  const steps = buildStepStatuses(
    pipeline,
    labels,
    currentStep,
    completedSteps,
  ).filter((step) => {
    if (mode === "analyze") {
      if (step.id.includes("_cross") && step.status === "pending") {
        return false;
      }
      if (step.id === "curriculum_agent" && step.status === "pending") {
        return false;
      }
    }
    return true;
  });

  const clampedPercent = Math.max(4, Math.min(100, percent));

  return (
    <div
      className="rounded-xl border border-rekabetli-border bg-rekabetli-surface/80 p-4"
      role="status"
      aria-live="polite"
      aria-busy={percent < 100}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-rekabetli-text">{label}</p>
          {detail ? (
            <p className="mt-0.5 truncate text-xs text-rekabetli-muted">
              {detail}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-rekabetli-primary">
          %{percent}
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-rekabetli-bg-soft">
        <div
          className="h-full rounded-full bg-gradient-to-r from-rekabetli-primary to-rekabetli-action transition-[width] duration-500 ease-out"
          style={{ width: `${clampedPercent}%` }}
        />
      </div>

      <ol className="mt-4 space-y-1.5">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`flex items-center gap-2 text-xs ${
              step.status === "active"
                ? "font-medium text-rekabetli-text"
                : step.status === "done"
                  ? "text-emerald-400/90"
                  : "text-rekabetli-muted/70"
            }`}
          >
            <span
              className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                step.status === "active"
                  ? "bg-rekabetli-action text-white"
                  : step.status === "done"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-rekabetli-bg-soft text-rekabetli-muted"
              }`}
              aria-hidden
            >
              {step.status === "done" ? "✓" : step.status === "active" ? "…" : ""}
            </span>
            <span className="truncate">{step.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
