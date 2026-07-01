"use client";

import { useCallback, useMemo, useState } from "react";
import NotalNoteViewer from "@/components/NotalNoteViewer";
import ExamPrepStatusBar from "@/components/ExamPrepStatusBar";
import type {
  CurriculumPdfReport,
  KazanımAlignmentResult,
  MaterialPdfReport,
  QuestionPdfReport,
} from "@/lib/agents/exam_prep/types";
import type { ExamPrepPersistenceResult } from "@/lib/agents/exam_prep/persistence/types";
import type { StudyTopicItem } from "@/lib/agents/exam_prep/study/types";
import {
  estimateExamPrepAnalysis,
  estimateExamPrepFull,
  estimateExamPrepStudy,
  formatCostUsd,
} from "@/lib/exam-prep/estimates";
import { EXAM_PREP_MAX_VISION_PAGES } from "@/lib/exam-prep/constants";
import { readNdjsonResponse } from "@/lib/exam-prep/ndjson-client";
import {
  getStudyStepLabel,
  getStudyStepPercent,
  type ProgressUpdate,
} from "@/lib/exam-prep/progress";
import { ensureNotalVisitorCookie, notalFetch } from "@/lib/notal-visitor-id";

type AppPhase = "landing" | "form" | "results" | "study";

interface ProgressState {
  step: string;
  label: string;
  percent: number;
  detail?: string;
  completedSteps: string[];
}

function applyProgressUpdate(
  prev: ProgressState | null,
  update: ProgressUpdate,
): ProgressState {
  const completedSteps =
    prev && prev.step !== update.step && !prev.completedSteps.includes(prev.step)
      ? [...prev.completedSteps, prev.step]
      : (prev?.completedSteps ?? []);

  return {
    step: update.step,
    label: update.label,
    percent: update.percent,
    detail: update.detail,
    completedSteps,
  };
}

interface ExamPrepApiResult {
  examGoal: string;
  curriculum: string | null;
  subject: string | null;
  supervisorSummary: string;
  materialReports: MaterialPdfReport[];
  questionReports: QuestionPdfReport[];
  curriculumReports?: CurriculumPdfReport[];
  kazanımAlignment?: KazanımAlignmentResult | null;
  persistence?: ExamPrepPersistenceResult | null;
  steps: string[];
  ingestErrors?: string[];
  visionPdfCount?: number;
  error?: string;
}

const SUBJECT_OPTIONS = [
  "",
  "Matematik",
  "Geometri",
  "Fizik",
  "Kimya",
  "Biyoloji",
  "Türkçe",
  "Tarih",
  "Coğrafya",
  "Felsefe",
  "Din Kültürü",
];

function PdfFileList({
  files,
  onRemove,
}: {
  files: File[];
  onRemove: (index: number) => void;
}) {
  if (!files.length) {
    return (
      <p className="text-xs text-rekabetli-muted">Henüz dosya seçilmedi.</p>
    );
  }

  return (
    <ul className="mt-2 space-y-1">
      {files.map((file, index) => (
        <li
          key={`${file.name}-${index}`}
          className="flex items-center justify-between gap-2 rounded-lg bg-rekabetli-bg-soft/60 px-2 py-1.5 text-xs"
        >
          <span className="truncate text-rekabetli-text">{file.name}</span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="shrink-0 text-rekabetli-muted hover:text-red-400"
          >
            Kaldır
          </button>
        </li>
      ))}
    </ul>
  );
}

function AlignmentScoreCard({
  alignment,
}: {
  alignment: KazanımAlignmentResult;
}) {
  const scoreColor =
    alignment.overallAlignmentPct >= 70
      ? "text-emerald-400"
      : alignment.overallAlignmentPct >= 40
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="rounded-xl border border-rekabetli-border bg-gradient-to-br from-rekabetli-surface/90 to-rekabetli-bg-soft/40 p-5">
      <h2 className="text-sm font-semibold text-rekabetli-text">
        Kazanım uyumu
      </h2>
      <p className="mt-1 text-xs text-rekabetli-muted">
        Konu anlatımı PDF&apos;leri ile soru PDF&apos;lerinin kazanım örtüşmesi
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div>
          <p className={`text-4xl font-bold tabular-nums ${scoreColor}`}>
            %{alignment.overallAlignmentPct}
          </p>
          <p className="mt-1 text-xs text-rekabetli-muted">Genel uyum</p>
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p className="text-rekabetli-muted">
            Soruların anlatımla örtüşmesi:{" "}
            <strong className="text-rekabetli-text">
              %{alignment.questionCoveragePct}
            </strong>
            <span className="ml-1 text-xs">
              ({alignment.matchedCount}/{alignment.totalQuestionOutcomes} kazanım)
            </span>
          </p>
          <p className="text-rekabetli-muted">
            Anlatımın sorularla karşılanması:{" "}
            <strong className="text-rekabetli-text">
              %{alignment.materialCoveragePct}
            </strong>
            <span className="ml-1 text-xs">
              ({alignment.matchedCount}/{alignment.totalMaterialOutcomes} kazanım)
            </span>
          </p>
        </div>
      </div>

      {alignment.unmatchedQuestionOutcomes.length ||
      alignment.unmatchedMaterialOutcomes.length ? (
        <details className="mt-4 text-xs text-rekabetli-muted">
          <summary className="cursor-pointer font-medium text-rekabetli-text">
            Eşleşmeyen kazanımlar
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {alignment.unmatchedQuestionOutcomes.length ? (
              <div>
                <p className="font-medium text-rekabetli-text">
                  Sorularda var, anlatımda yok
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {alignment.unmatchedQuestionOutcomes.slice(0, 6).map((item) => (
                    <li key={`uq-${item.code}-${item.title}`}>{item.title}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {alignment.unmatchedMaterialOutcomes.length ? (
              <div>
                <p className="font-medium text-rekabetli-text">
                  Anlatımda var, sorularda yok
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {alignment.unmatchedMaterialOutcomes.slice(0, 6).map((item) => (
                    <li key={`um-${item.code}-${item.title}`}>{item.title}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ReportCard({
  title,
  fileName,
  children,
}: {
  title: string;
  fileName: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-xl border border-rekabetli-border bg-rekabetli-bg-soft/40 p-4">
      <p className="text-[11px] uppercase tracking-wide text-rekabetli-muted">
        {title}
      </p>
      <h3 className="mt-1 font-medium text-rekabetli-text">{fileName}</h3>
      <div className="mt-3 space-y-1 text-sm text-rekabetli-muted">
        {children}
      </div>
    </article>
  );
}

export default function NotalExamPrepApp() {
  const [phase, setPhase] = useState<AppPhase>("landing");
  const [examGoal, setExamGoal] = useState("");
  const [curriculum, setCurriculum] = useState("");
  const [subject, setSubject] = useState("");
  const [materialFiles, setMaterialFiles] = useState<File[]>([]);
  const [questionFiles, setQuestionFiles] = useState<File[]>([]);
  const [curriculumFiles, setCurriculumFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExamPrepApiResult | null>(null);
  const [studyTopics, setStudyTopics] = useState<StudyTopicItem[]>([]);
  const [studyQueueSource, setStudyQueueSource] = useState<string>("");
  const [studyTopicIndex, setStudyTopicIndex] = useState(0);
  const [studyNote, setStudyNote] = useState<string | null>(null);
  const [studyLoading, setStudyLoading] = useState(false);
  const [studyError, setStudyError] = useState<string | null>(null);
  const [studyRevised, setStudyRevised] = useState(false);
  const [studySessionId, setStudySessionId] = useState<string | null>(null);
  const [studyCached, setStudyCached] = useState(false);
  const [sortedByAlignment, setSortedByAlignment] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<ProgressState | null>(
    null,
  );
  const [studyProgress, setStudyProgress] = useState<ProgressState | null>(
    null,
  );

  const formEstimate = useMemo(() => {
    return estimateExamPrepAnalysis({
      materialCount: materialFiles.length,
      questionCount: questionFiles.length,
      curriculumCount: curriculumFiles.length,
    });
  }, [materialFiles.length, questionFiles.length, curriculumFiles.length]);

  const canAnalyze = useMemo(
    () =>
      materialFiles.length + questionFiles.length + curriculumFiles.length > 0 &&
      !isAnalyzing,
    [
      materialFiles.length,
      questionFiles.length,
      curriculumFiles.length,
      isAnalyzing,
    ],
  );

  const addFiles = useCallback(
    (category: "material" | "question" | "curriculum", incoming: FileList | null) => {
      if (!incoming?.length) return;
      const pdfs = Array.from(incoming).filter((file) =>
        file.name.toLowerCase().endsWith(".pdf"),
      );
      if (category === "material") {
        setMaterialFiles((prev) => [...prev, ...pdfs].slice(0, 8));
      } else if (category === "question") {
        setQuestionFiles((prev) => [...prev, ...pdfs].slice(0, 8));
      } else {
        setCurriculumFiles((prev) => [...prev, ...pdfs].slice(0, 8));
      }
    },
    [],
  );

  async function handleAnalyze() {
    if (!canAnalyze) return;

    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    setAnalyzeProgress({
      step: "pdf_prepare",
      label: "PDF dosyaları hazırlanıyor",
      percent: 4,
      completedSteps: [],
    });

    try {
      await ensureNotalVisitorCookie();

      const formData = new FormData();
      formData.append("stream", "1");
      formData.append("examGoal", examGoal.trim() || "YKS sınav hazırlığı");
      if (curriculum.trim()) formData.append("curriculum", curriculum.trim());
      if (subject.trim()) formData.append("subject", subject.trim());

      for (const file of materialFiles) {
        formData.append("materialPdfs", file);
      }
      for (const file of questionFiles) {
        formData.append("questionPdfs", file);
      }
      for (const file of curriculumFiles) {
        formData.append("curriculumPdfs", file);
      }

      const response = await notalFetch("/api/notal/exam-prep", {
        method: "POST",
        body: formData,
      });

      const data = await readNdjsonResponse<ExamPrepApiResult>(
        response,
        (update) => {
          setAnalyzeProgress((prev) => applyProgressUpdate(prev, update));
        },
      );

      setAnalyzeProgress((prev) =>
        prev
          ? {
              ...prev,
              step: "supervisor_synthesize",
              label: "Tamamlandı",
              percent: 100,
              completedSteps: [...prev.completedSteps, prev.step],
            }
          : null,
      );

      setResult(data);
      setPhase("results");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Bağlantı hatası. Lütfen tekrar deneyin.",
      );
    } finally {
      setIsAnalyzing(false);
      setAnalyzeProgress(null);
    }
  }

  function resetFlow() {
    setPhase("landing");
    setResult(null);
    setError(null);
    setMaterialFiles([]);
    setQuestionFiles([]);
    setCurriculumFiles([]);
    setExamGoal("");
    setCurriculum("");
    setSubject("");
    setStudyTopics([]);
    setStudyQueueSource("");
    setStudyTopicIndex(0);
    setStudyNote(null);
    setStudyError(null);
    setStudyRevised(false);
    setStudySessionId(null);
    setStudyCached(false);
    setSortedByAlignment(false);
    setAnalyzeProgress(null);
    setStudyProgress(null);
  }

  async function startStudySession() {
    if (!result) return;

    setStudyLoading(true);
    setStudyError(null);
    setStudyNote(null);
    setStudyProgress({
      step: "study_init",
      label: getStudyStepLabel("study_init"),
      percent: getStudyStepPercent("study_init"),
      completedSteps: [],
    });

    try {
      await ensureNotalVisitorCookie();

      const initResponse = await notalFetch("/api/notal/exam-prep/study/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examGoal: result.examGoal,
          curriculum: result.curriculum,
          subject: result.subject,
          materialReports: result.materialReports,
          questionReports: result.questionReports,
          curriculumReports: result.curriculumReports ?? [],
          kazanımAlignment: result.kazanımAlignment ?? null,
        }),
      });

      const initData = (await initResponse.json()) as {
        sessionId?: string | null;
        topics?: StudyTopicItem[];
        queueSource?: string;
        sortedByAlignment?: boolean;
        error?: string;
      };

      if (!initResponse.ok || !initData.topics?.length) {
        setStudyError(initData.error ?? "Çalışma kuyruğu oluşturulamadı.");
        return;
      }

      setStudyTopics(initData.topics);
      setStudyQueueSource(initData.queueSource ?? "");
      setStudySessionId(initData.sessionId ?? null);
      setSortedByAlignment(Boolean(initData.sortedByAlignment));
      setStudyTopicIndex(0);
      setPhase("study");
      await generateStudyTopicNote(0, initData.topics, initData.sessionId ?? null);
    } catch {
      setStudyError("Çalışma oturumu başlatılamadı.");
    } finally {
      setStudyLoading(false);
      setStudyProgress(null);
    }
  }

  async function generateStudyTopicNote(
    index: number,
    topics: StudyTopicItem[] = studyTopics,
    sessionIdOverride?: string | null,
  ) {
    if (!result || !topics[index]) return;

    setStudyLoading(true);
    setStudyError(null);
    setStudyNote(null);
    setStudyRevised(false);
    setStudyCached(false);
    setStudyProgress({
      step: "study_retrieve",
      label: getStudyStepLabel("study_retrieve"),
      percent: getStudyStepPercent("study_retrieve"),
      completedSteps: sessionIdOverride ? [] : ["study_init"],
    });

    const activeSessionId = sessionIdOverride ?? studySessionId;

    try {
      await ensureNotalVisitorCookie();

      const response = await notalFetch("/api/notal/exam-prep/study/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: true,
          sessionId: activeSessionId,
          topic: topics[index],
          topicIndex: index,
          totalTopics: topics.length,
          examGoal: result.examGoal,
          curriculum: result.curriculum,
          subject: result.subject,
        }),
      });

      const data = await readNdjsonResponse<{
        markdown?: string;
        revised?: boolean;
        cached?: boolean;
        error?: string;
      }>(response, (update) => {
        setStudyProgress((prev) => applyProgressUpdate(prev, update));
      });

      if (!data.markdown) {
        setStudyError(data.error ?? "Not üretilemedi.");
        return;
      }

      setStudyProgress((prev) =>
        prev
          ? {
              ...prev,
              step: "study_note_draft",
              label: "Tamamlandı",
              percent: 100,
              completedSteps: [...prev.completedSteps, prev.step],
            }
          : null,
      );

      setStudyNote(data.markdown);
      setStudyRevised(Boolean(data.revised));
      setStudyCached(Boolean(data.cached));
      setStudyTopicIndex(index);
    } catch (err) {
      setStudyError(
        err instanceof Error
          ? err.message
          : "Not üretimi sırasında bağlantı hatası.",
      );
    } finally {
      setStudyLoading(false);
      setStudyProgress(null);
    }
  }

  async function handleNextStudyTopic() {
    const nextIndex = studyTopicIndex + 1;
    if (nextIndex >= studyTopics.length) return;
    await generateStudyTopicNote(nextIndex);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {phase === "landing" ? (
        <section className="rounded-2xl border border-rekabetli-border bg-gradient-to-br from-rekabetli-surface/90 to-rekabetli-bg-soft/50 p-8 text-center sm:p-12">
          <p className="text-xs font-medium uppercase tracking-widest text-rekabetli-primary">
            NotAl — Sınav Hazırlığı
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-rekabetli-text sm:text-3xl">
            Elindeki kaynaklarla sınava hazırlan
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm text-rekabetli-muted">
            Konu anlatımı PDF&apos;lerini ve çıkmış / örnek soru kitaplarını yükle.
            Multi-agent sistem her dosyayı analiz edip envanter çıkarır.
          </p>
          <button
            type="button"
            onClick={() => setPhase("form")}
            className="mt-8 rounded-xl bg-rekabetli-action px-8 py-3.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Sınava hazırlan
          </button>
        </section>
      ) : null}

      {phase === "form" ? (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-rekabetli-text">
                Materyallerini yükle
              </h1>
              <p className="mt-1 text-sm text-rekabetli-muted">
                Konu anlatımı, soru ve sınav müfredatı PDF&apos;lerini yükleyin.
              </p>
            </div>
            <button
              type="button"
              onClick={resetFlow}
              className="text-xs text-rekabetli-muted hover:text-rekabetli-text"
            >
              Başa dön
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm sm:col-span-2">
              <span className="text-rekabetli-muted">Sınav hedefi</span>
              <input
                type="text"
                value={examGoal}
                onChange={(event) => setExamGoal(event.target.value)}
                placeholder="Örn. 2026 TYT Biyoloji"
                className="mt-1 w-full rounded-lg border border-rekabetli-border bg-rekabetli-bg-soft px-3 py-2 text-sm text-rekabetli-text"
              />
            </label>
            <label className="block text-sm">
              <span className="text-rekabetli-muted">Sınav türü</span>
              <select
                value={curriculum}
                onChange={(event) => setCurriculum(event.target.value)}
                className="mt-1 w-full rounded-lg border border-rekabetli-border bg-rekabetli-bg-soft px-3 py-2 text-sm text-rekabetli-text"
              >
                <option value="">Seçiniz</option>
                <option value="TYT">TYT</option>
                <option value="AYT">AYT</option>
                <option value="genel">Genel</option>
              </select>
            </label>
            <label className="block text-sm sm:col-span-3 sm:max-w-xs">
              <span className="text-rekabetli-muted">Ders (isteğe bağlı)</span>
              <select
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="mt-1 w-full rounded-lg border border-rekabetli-border bg-rekabetli-bg-soft px-3 py-2 text-sm text-rekabetli-text"
              >
                {SUBJECT_OPTIONS.map((option) => (
                  <option key={option || "auto"} value={option}>
                    {option || "Otomatik"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-dashed border-rekabetli-border bg-rekabetli-surface/50 p-5">
              <h2 className="font-medium text-rekabetli-text">
                Konu anlatımı PDF&apos;leri
              </h2>
              <p className="mt-1 text-xs text-rekabetli-muted">
                Ders notları, konu özetleri, MEB kitapları (en fazla 8 dosya)
              </p>
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={(event) => {
                  addFiles("material", event.target.files);
                  event.target.value = "";
                }}
                className="mt-4 block w-full text-xs text-rekabetli-muted file:mr-3 file:rounded-lg file:border-0 file:bg-rekabetli-primary file:px-3 file:py-2 file:text-white"
              />
              <PdfFileList
                files={materialFiles}
                onRemove={(index) =>
                  setMaterialFiles((prev) => prev.filter((_, i) => i !== index))
                }
              />
            </div>

            <div className="rounded-xl border border-dashed border-rekabetli-border bg-rekabetli-surface/50 p-5">
              <h2 className="font-medium text-rekabetli-text">
                Soru PDF&apos;leri
              </h2>
              <p className="mt-1 text-xs text-rekabetli-muted">
                Çıkmış sorular, örnek sorular, testler (en fazla 8 dosya)
              </p>
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={(event) => {
                  addFiles("question", event.target.files);
                  event.target.value = "";
                }}
                className="mt-4 block w-full text-xs text-rekabetli-muted file:mr-3 file:rounded-lg file:border-0 file:bg-rekabetli-primary file:px-3 file:py-2 file:text-white"
              />
              <PdfFileList
                files={questionFiles}
                onRemove={(index) =>
                  setQuestionFiles((prev) => prev.filter((_, i) => i !== index))
                }
              />
            </div>

            <div className="rounded-xl border border-dashed border-rekabetli-border bg-rekabetli-surface/50 p-5">
              <h2 className="font-medium text-rekabetli-text">
                Sınav müfredatı PDF&apos;leri
              </h2>
              <p className="mt-1 text-xs text-rekabetli-muted">
                MEB öğretim programı, kazanım listesi, YKS müfredat tablosu (en fazla 8)
              </p>
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={(event) => {
                  addFiles("curriculum", event.target.files);
                  event.target.value = "";
                }}
                className="mt-4 block w-full text-xs text-rekabetli-muted file:mr-3 file:rounded-lg file:border-0 file:bg-rekabetli-primary file:px-3 file:py-2 file:text-white"
              />
              <PdfFileList
                files={curriculumFiles}
                onRemove={(index) =>
                  setCurriculumFiles((prev) => prev.filter((_, i) => i !== index))
                }
              />
            </div>
          </div>

          {materialFiles.length +
            questionFiles.length +
            curriculumFiles.length >
          0 ? (
            <div className="rounded-lg border border-rekabetli-border bg-rekabetli-bg-soft/40 p-3 text-xs text-rekabetli-muted">
              <p>
                Tahmini analiz süresi: ~{formEstimate.analysisMinutes} dk ·
                maliyet {formatCostUsd(formEstimate.analysisCostUsd)}
              </p>
              <p className="mt-1">
                Taranmış PDF&apos;lerde vision ile en fazla{" "}
                {EXAM_PREP_MAX_VISION_PAGES} sayfa okunur.
              </p>
              {formEstimate.warnings.length ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-amber-400/90">
                  {formEstimate.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="button"
            disabled={!canAnalyze}
            onClick={() => void handleAnalyze()}
            className="w-full rounded-xl bg-rekabetli-action px-4 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAnalyzing
              ? "Ajanlar materyalleri analiz ediyor…"
              : "Materyalleri analiz et"}
          </button>

          {isAnalyzing && analyzeProgress ? (
            <ExamPrepStatusBar
              mode="analyze"
              label={analyzeProgress.label}
              percent={analyzeProgress.percent}
              detail={analyzeProgress.detail}
              currentStep={analyzeProgress.step}
              completedSteps={analyzeProgress.completedSteps}
            />
          ) : null}
        </section>
      ) : null}

      {phase === "results" && result ? (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-rekabetli-text">
                Materyal envanteri
              </h1>
              <p className="mt-1 text-sm text-rekabetli-muted">
                {result.examGoal}
                {result.curriculum ? ` · ${result.curriculum}` : ""}
                {result.subject ? ` · ${result.subject}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={resetFlow}
              className="rounded-lg border border-rekabetli-border px-3 py-1.5 text-xs text-rekabetli-text hover:bg-rekabetli-bg-soft"
            >
              Yeni analiz
            </button>
          </div>

          {result.persistence?.enabled ? (
            <div className="rounded-xl border border-rekabetli-border bg-rekabetli-surface/70 p-5">
              <h2 className="text-sm font-semibold text-rekabetli-text">
                Supabase kaydı
              </h2>
              <p className="mt-1 text-sm text-rekabetli-muted">
                {result.persistence.totalChunks} metin chunk ·{" "}
                {result.persistence.totalFigures} soru görseli kaydedildi
              </p>
              {result.persistence.pdfs.length ? (
                <ul className="mt-3 space-y-1 text-xs text-rekabetli-muted">
                  {result.persistence.pdfs.map((item) => (
                    <li key={`${item.pdfId}-${item.role}`}>
                      {item.fileName} (
                      {item.role === "material"
                        ? "konu"
                        : item.role === "question"
                          ? "soru"
                          : "müfredat"}
                      , {item.mode === "vision" ? "taranmış" : "metin"}):{" "}
                      {item.storedChunks} chunk, {item.storedFigures} görsel
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {result.kazanımAlignment ? (
            <AlignmentScoreCard alignment={result.kazanımAlignment} />
          ) : null}

          <div className="rounded-xl border border-rekabetli-primary/30 bg-rekabetli-primary/5 p-5">
            <h2 className="text-sm font-semibold text-rekabetli-text">
              Konu konu çalış
            </h2>
            <p className="mt-1 text-sm text-rekabetli-muted">
              Eksik kazanımlar önce sıralanır. Notlar oturumda cache&apos;lenir.
            </p>
            {result.kazanımAlignment ? (
              <p className="mt-2 text-xs text-rekabetli-muted">
                Çalışma tahmini: ~
                {estimateExamPrepStudy(
                  Math.min(
                    30,
                    (result.curriculumReports?.length
                      ? result.curriculumReports.flatMap((r) => r.learningOutcomes)
                          .length
                      : 0) ||
                      result.materialReports.flatMap((r) => r.topics).length ||
                      10,
                  ),
                ).studyMinutes}{" "}
                dk ·{" "}
                {formatCostUsd(
                  estimateExamPrepFull({
                    materialCount: result.materialReports.length,
                    questionCount: result.questionReports.length,
                    curriculumCount: result.curriculumReports?.length ?? 0,
                    visionPdfCount: result.visionPdfCount,
                    studyTopicCount: 10,
                  }).studyCostUsd,
                )}
              </p>
            ) : null}
            {studyError ? (
              <p className="mt-2 text-sm text-red-400">{studyError}</p>
            ) : null}
            <button
              type="button"
              disabled={studyLoading}
              onClick={() => void startStudySession()}
              className="mt-4 rounded-xl bg-rekabetli-action px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {studyLoading ? "Hazırlanıyor…" : "Çalışmaya başla"}
            </button>
          </div>

          <div className="rounded-xl border border-rekabetli-border bg-rekabetli-surface/70 p-5">
            <h2 className="text-sm font-semibold text-rekabetli-text">
              Supervisor özeti
            </h2>
            <div className="mt-3">
              <NotalNoteViewer content={result.supervisorSummary} />
            </div>
          </div>

          {result.materialReports.length ? (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-rekabetli-text">
                Kaynak ajanı — konu PDF&apos;leri
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {result.materialReports.map((report) => (
                  <ReportCard
                    key={`m-${report.pdfId}`}
                    title="Kaynak analizi"
                    fileName={report.fileName}
                  >
                    <p>{report.summary}</p>
                    {report.analysisMode === "vision" ? (
                      <p className="text-rekabetli-primary">
                        Taranmış PDF — sayfa görseli ile okundu
                      </p>
                    ) : null}
                    {report.topics.length ? (
                      <p>
                        <strong>Konular:</strong> {report.topics.join(", ")}
                      </p>
                    ) : null}
                    <p>
                      Yoğunluk: {report.density} · Önem: {report.importance}
                    </p>
                    {report.estimatedQuestionCount > 0 ? (
                      <p>Tahmini soru: {report.estimatedQuestionCount}</p>
                    ) : null}
                    {report.learningOutcomes?.length ? (
                      <p>
                        <strong>Kazanımlar:</strong>{" "}
                        {report.learningOutcomes.length} madde
                      </p>
                    ) : null}
                    {report.transferredToQuestions ? (
                      <p className="text-rekabetli-primary">
                        Soru ajanına da aktarıldı
                      </p>
                    ) : null}
                  </ReportCard>
                ))}
              </div>
            </div>
          ) : null}

          {result.questionReports.length ? (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-rekabetli-text">
                Soru ajanı — soru PDF&apos;leri
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {result.questionReports.map((report) => (
                  <ReportCard
                    key={`q-${report.pdfId}`}
                    title="Soru analizi"
                    fileName={report.fileName}
                  >
                    <p>{report.summary}</p>
                    {report.analysisMode === "vision" ? (
                      <p className="text-rekabetli-primary">
                        Taranmış PDF — sayfa görseli ile okundu
                      </p>
                    ) : null}
                    <p>Tahmini soru sayısı: {report.questionCountEstimate}</p>
                    {report.questionTypes.length ? (
                      <p>Türler: {report.questionTypes.join(", ")}</p>
                    ) : null}
                    <p>
                      Zorluk: %{report.difficultyEasyPct} kolay · %
                      {report.difficultyMediumPct} orta · %
                      {report.difficultyHardPct} zor
                    </p>
                    {report.learningOutcomes?.length ? (
                      <p>
                        <strong>Kazanımlar:</strong>{" "}
                        {report.learningOutcomes.length} madde
                      </p>
                    ) : null}
                    {report.transferredToMaterials ? (
                      <p className="text-rekabetli-primary">
                        Kaynak ajanına da aktarıldı
                      </p>
                    ) : null}
                  </ReportCard>
                ))}
              </div>
            </div>
          ) : null}

          {result.curriculumReports?.length ? (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-rekabetli-text">
                Müfredat ajanı — sınav müfredatı PDF&apos;leri
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {result.curriculumReports.map((report) => (
                  <ReportCard
                    key={`c-${report.pdfId}`}
                    title="Müfredat analizi"
                    fileName={report.fileName}
                  >
                    <p>{report.summary}</p>
                    {report.analysisMode === "vision" ? (
                      <p className="text-rekabetli-primary">
                        Taranmış PDF — sayfa görseli ile okundu
                      </p>
                    ) : null}
                    {report.units.length ? (
                      <p>
                        <strong>Üniteler:</strong> {report.units.join(", ")}
                      </p>
                    ) : null}
                    <p>
                      {report.curriculum} · Sınıf: {report.gradeLevel}
                    </p>
                    {report.totalOutcomeEstimate > 0 ? (
                      <p>Tahmini kazanım: {report.totalOutcomeEstimate}</p>
                    ) : null}
                    {report.learningOutcomes?.length ? (
                      <p>
                        <strong>Kazanımlar:</strong>{" "}
                        {report.learningOutcomes.length} madde
                      </p>
                    ) : null}
                  </ReportCard>
                ))}
              </div>
            </div>
          ) : null}

          {result.ingestErrors?.length ? (
            <details className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
              <summary className="cursor-pointer">
                Yükleme uyarıları ({result.ingestErrors.length})
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {result.ingestErrors.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}

          <details className="rounded-lg border border-rekabetli-border p-3 text-xs text-rekabetli-muted">
            <summary className="cursor-pointer font-medium">
              Agent adımları ({result.steps.length})
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              {result.steps.map((step, index) => (
                <li key={`${step}-${index}`}>{step}</li>
              ))}
            </ol>
          </details>
        </section>
      ) : null}

      {phase === "study" ? (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-rekabetli-text">
                {studyTopics[studyTopicIndex]?.title ?? "Çalışma notu"}
              </h1>
              <p className="mt-1 text-sm text-rekabetli-muted">
                Konu {studyTopicIndex + 1} / {studyTopics.length}
                {studyQueueSource === "curriculum"
                  ? " · müfredat kazanımları"
                  : studyQueueSource === "material"
                    ? " · konu anlatımı"
                    : ""}
                {sortedByAlignment ? " · eksik kazanımlar önce" : ""}
                {studyTopics[studyTopicIndex]?.gapScore
                  ? ` · öncelik skoru ${studyTopics[studyTopicIndex].gapScore}`
                  : ""}
                {studyRevised ? " · supervisor revizyonu" : ""}
                {studyCached ? " · önbellekten" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={resetFlow}
              className="rounded-lg border border-rekabetli-border px-3 py-1.5 text-xs text-rekabetli-text hover:bg-rekabetli-bg-soft"
            >
              Çık
            </button>
          </div>

          {studyLoading && studyProgress ? (
            <ExamPrepStatusBar
              mode="study"
              label={studyProgress.label}
              percent={studyProgress.percent}
              detail={studyProgress.detail}
              currentStep={studyProgress.step}
              completedSteps={studyProgress.completedSteps}
            />
          ) : null}

          {studyError ? (
            <p className="text-sm text-red-400">{studyError}</p>
          ) : null}

          {studyNote && !studyLoading ? (
            <div className="rounded-xl border border-rekabetli-border bg-rekabetli-surface/70 p-5">
              <NotalNoteViewer content={studyNote} />
            </div>
          ) : null}

          {!studyLoading && studyNote ? (
            <div className="flex flex-wrap gap-3">
              {studyTopicIndex + 1 < studyTopics.length ? (
                <button
                  type="button"
                  onClick={() => void handleNextStudyTopic()}
                  className="rounded-xl bg-rekabetli-action px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Sonraki konu ({studyTopicIndex + 2}/{studyTopics.length})
                </button>
              ) : (
                <p className="text-sm text-rekabetli-primary">
                  Tüm konular tamamlandı.
                </p>
              )}
              <button
                type="button"
                onClick={() => setPhase("results")}
                className="rounded-xl border border-rekabetli-border px-4 py-3 text-sm text-rekabetli-text hover:bg-rekabetli-bg-soft"
              >
                Envantere dön
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
