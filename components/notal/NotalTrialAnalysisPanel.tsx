"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import {
  fileToPendingAttachment,
  toAttachmentInput,
  type PendingChatAttachment,
} from "@/lib/notal/chat-attachments";
import type {
  NotalStudentProfile,
  YksArea,
  YksExam,
} from "@/lib/notal/student-context";
import {
  formatTrialAnalysisSummary,
  formatTrialBranchStats,
  MAX_TRIAL_ANALYSIS_IMAGES,
  type NotalTrialAnalysis,
  type NotalTrialBranchStat,
  type TrialAnalysisKind,
} from "@/lib/notal/trial-analysis";
import {
  computeNetFromWrongBlank,
  getBranchQuestionCount,
  getExamQuestionCount,
  validateBranchStatsAgainstTotal,
  validateTrialStats,
} from "@/lib/notal/trial-question-counts";
import { getFilteredYksTopics } from "@/lib/notal/yks-topics";

type Props = {
  analyses: NotalTrialAnalysis[];
  yksArea: YksArea | null;
  ydsEnabled: boolean;
  enabledExams: YksExam[];
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onCreated: (
    analysis: NotalTrialAnalysis,
    context?: NotalStudentProfile | null,
  ) => void;
  onOpenSolution: (solutionId: string, analysis: NotalTrialAnalysis) => void;
  onOpenCard: (cardId: string, analysis: NotalTrialAnalysis) => void;
};

type BranchDraft = {
  wrongCount: string;
  blankCount: string;
};

type TrialPhotoItem = {
  attachment: PendingChatAttachment;
  mistakeKind: "wrong" | "blank" | null;
};

function parseOptionalCount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export default function NotalTrialAnalysisPanel({
  analyses,
  yksArea,
  ydsEnabled,
  enabledExams,
  authFetch,
  onCreated,
  onOpenSolution,
  onOpenCard,
}: Props) {
  const [kind, setKind] = useState<TrialAnalysisKind>("general");
  const [exam, setExam] = useState<YksExam>(enabledExams[0] ?? "TYT");
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [wrongCount, setWrongCount] = useState("");
  const [blankCount, setBlankCount] = useState("");
  const [showBranchStats, setShowBranchStats] = useState(false);
  const [branchDrafts, setBranchDrafts] = useState<Record<string, BranchDraft>>(
    {},
  );
  const [photos, setPhotos] = useState<TrialPhotoItem[]>([]);
  const [listTab, setListTab] = useState<TrialAnalysisKind>("general");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const branches = useMemo(() => {
    return getFilteredYksTopics(exam, yksArea, { ydsEnabled }).branches.map(
      (item) => item.name,
    );
  }, [exam, yksArea, ydsEnabled]);

  const examQuestionCount = getExamQuestionCount(exam);
  const questionCountForNet =
    kind === "branch"
      ? branch
        ? getBranchQuestionCount(exam, branch, yksArea)
        : null
      : examQuestionCount;

  const generalAnalyses = analyses.filter((item) => item.kind === "general");
  const branchAnalyses = analyses.filter((item) => item.kind === "branch");
  const latest = analyses[0] ?? null;

  const computedNetPreview = useMemo(() => {
    const wrongValue = parseOptionalCount(wrongCount);
    const blankValue = parseOptionalCount(blankCount);
    if (
      questionCountForNet === null ||
      wrongValue === null ||
      blankValue === null ||
      Number.isNaN(wrongValue) ||
      Number.isNaN(blankValue)
    ) {
      return null;
    }
    const result = computeNetFromWrongBlank(
      questionCountForNet,
      wrongValue,
      blankValue,
    );
    return result.ok ? result.net : null;
  }, [blankCount, questionCountForNet, wrongCount]);

  function updateBranchDraft(
    branchName: string,
    field: keyof BranchDraft,
    value: string,
  ) {
    setBranchDrafts((prev) => ({
      ...prev,
      [branchName]: {
        wrongCount: prev[branchName]?.wrongCount ?? "",
        blankCount: prev[branchName]?.blankCount ?? "",
        [field]: value,
      },
    }));
  }

  function collectBranchStats():
    { ok: true; stats: NotalTrialBranchStat[] } | { ok: false; error: string } {
    const stats: NotalTrialBranchStat[] = [];
    for (const branchName of branches) {
      const draft = branchDrafts[branchName];
      if (!draft) continue;
      if (draft.wrongCount.trim() === "" && draft.blankCount.trim() === "") {
        continue;
      }
      const rowWrong = parseOptionalCount(draft.wrongCount);
      const rowBlank = parseOptionalCount(draft.blankCount);
      if (Number.isNaN(rowWrong) || Number.isNaN(rowBlank)) {
        return { ok: false, error: `${branchName}: geçersiz sayı.` };
      }
      if (rowWrong === null || rowBlank === null) {
        return {
          ok: false,
          error: `${branchName}: yanlış ve boş birlikte girilmeli.`,
        };
      }
      const q = getBranchQuestionCount(exam, branchName, yksArea);
      if (q === null) {
        return {
          ok: false,
          error: `${branchName}: soru sayısı tanımsız; net hesaplanamaz.`,
        };
      }
      const computed = computeNetFromWrongBlank(q, rowWrong, rowBlank);
      if (!computed.ok) {
        return { ok: false, error: `${branchName}: ${computed.error}` };
      }
      stats.push({
        branch: branchName,
        net: computed.net,
        wrongCount: rowWrong,
        blankCount: rowBlank,
      });
    }
    return { ok: true, stats };
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const next = [...photos];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_TRIAL_ANALYSIS_IMAGES) {
        setError(
          `En fazla ${MAX_TRIAL_ANALYSIS_IMAGES} görsel ekleyebilirsin.`,
        );
        break;
      }
      try {
        const pending = await fileToPendingAttachment(file);
        if (pending.kind !== "image") {
          setError("Deneme analizi için yalnızca görsel ekleyebilirsin.");
          continue;
        }
        next.push({ attachment: pending, mistakeKind: null });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Dosya eklenemedi.");
      }
    }
    setPhotos(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (kind === "branch" && !branch) {
      setError("Branş denemesi için branş seçmelisin.");
      return;
    }

    const wrongValue = parseOptionalCount(wrongCount);
    const blankValue = parseOptionalCount(blankCount);
    if (Number.isNaN(wrongValue) || Number.isNaN(blankValue)) {
      setError("Yanlış / boş değerleri geçersiz.");
      return;
    }

    const hasWrongOrBlank = wrongValue !== null || blankValue !== null;
    if (hasWrongOrBlank && (wrongValue === null || blankValue === null)) {
      setError("Net için yanlış ve boş birlikte girilmeli.");
      return;
    }

    let netValue: number | null = null;
    if (wrongValue !== null && blankValue !== null) {
      if (questionCountForNet === null) {
        setError(
          kind === "branch"
            ? "Bu branş için soru sayısı tanımsız; net hesaplanamaz."
            : "Soru sayısı bulunamadı; net hesaplanamaz.",
        );
        return;
      }
      const computed = computeNetFromWrongBlank(
        questionCountForNet,
        wrongValue,
        blankValue,
      );
      if (!computed.ok) {
        setError(computed.error);
        return;
      }
      netValue = computed.net;
    }

    let branchStats: NotalTrialBranchStat[] = [];
    if (kind === "general") {
      const collected = collectBranchStats();
      if (!collected.ok) {
        setError(collected.error);
        return;
      }
      branchStats = collected.stats;
      const check = validateBranchStatsAgainstTotal({
        exam,
        total: {
          net: netValue,
          wrongCount: wrongValue,
          blankCount: blankValue,
        },
        branches: branchStats,
      });
      if (!check.ok) {
        setError(check.error || "Yanlış / boş tutarsız.");
        return;
      }
    } else if (netValue !== null) {
      const check = validateTrialStats(
        {
          net: netValue,
          wrongCount: wrongValue,
          blankCount: blankValue,
        },
        questionCountForNet,
        branch || "Branş",
      );
      if (!check.ok) {
        setError(check.error || "Yanlış / boş tutarsız.");
        return;
      }
    }

    if (photos.length) {
      const unmarked = photos.find((item) => !item.mistakeKind);
      if (unmarked) {
        setError("Her fotoğraf için Yanlış veya Boş seçmelisin.");
        return;
      }
      if (wrongValue !== null) {
        const wrongPhotos = photos.filter(
          (p) => p.mistakeKind === "wrong",
        ).length;
        if (wrongPhotos > wrongValue) {
          setError(
            `Yanlış işaretli fotoğraf (${wrongPhotos}), girdiğin yanlış sayısından (${wrongValue}) fazla olamaz.`,
          );
          return;
        }
      }
      if (blankValue !== null) {
        const blankPhotos = photos.filter(
          (p) => p.mistakeKind === "blank",
        ).length;
        if (blankPhotos > blankValue) {
          setError(
            `Boş işaretli fotoğraf (${blankPhotos}), girdiğin boş sayısından (${blankValue}) fazla olamaz.`,
          );
          return;
        }
      }
    }

    setSubmitting(true);
    setError("");
    try {
      const payload = {
        kind,
        exam,
        branch: kind === "branch" ? branch : null,
        name: name.trim() || null,
        takenAt: new Date().toISOString().slice(0, 10),
        tytNet: exam === "TYT" ? netValue : null,
        aytNet: exam === "AYT" ? netValue : null,
        ydsNet: exam === "YDS" ? netValue : null,
        branchNet: kind === "branch" ? netValue : null,
        wrongCount: wrongValue,
        blankCount: blankValue,
        branchStats: kind === "general" ? branchStats : [],
        attachments: photos.map((item) => ({
          ...toAttachmentInput(item.attachment),
          mistakeKind: item.mistakeKind,
        })),
      };

      const response = await authFetch("/api/notal/trial-analysis", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let code = "save_failed";
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) code = body.error;
        } catch {
          /* ignore */
        }
        setError(
          code === "service_role_not_configured"
            ? "Kayıt servisi yapılandırılmamış."
            : code === "branch_required"
              ? "Branş seçmelisin."
              : code !== "save_failed"
                ? code
                : "Deneme analizi kaydedilemedi.",
        );
        return;
      }

      const body = (await response.json()) as {
        analysis?: NotalTrialAnalysis;
        context?: NotalStudentProfile;
      };
      if (!body.analysis) {
        setError("Deneme analizi kaydedilemedi.");
        return;
      }

      onCreated(body.analysis, body.context ?? null);
      setName("");
      setWrongCount("");
      setBlankCount("");
      setBranchDrafts({});
      setShowBranchStats(false);
      setPhotos([]);
      setBranch("");
    } catch {
      setError("Deneme analizi kaydedilemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  function renderAnalysisItem(item: NotalTrialAnalysis) {
    const branchLine =
      item.kind === "general" ? formatTrialBranchStats(item) : null;
    return (
      <li key={item.id} className="notal-trial-list-item">
        <div className="notal-trial-list-main">
          <strong>
            {item.name}
            {latest?.id === item.id ? (
              <span className="notal-trial-badge">Son</span>
            ) : null}
          </strong>
          <span>{formatTrialAnalysisSummary(item)}</span>
          {item.wrongCount !== null || item.blankCount !== null ? (
            <small>
              {item.wrongCount !== null ? `${item.wrongCount} yanlış` : null}
              {item.wrongCount !== null && item.blankCount !== null
                ? " · "
                : null}
              {item.blankCount !== null ? `${item.blankCount} boş` : null}
            </small>
          ) : null}
          {branchLine ? (
            <small className="notal-trial-branch-summary">{branchLine}</small>
          ) : null}
        </div>
        {item.solutions.length || item.knowledgeCards.length ? (
          <div className="notal-trial-list-actions">
            {item.solutions.map((sol, idx) => (
              <button
                key={sol.id}
                type="button"
                className="notal-topic-solution-btn"
                onClick={() => onOpenSolution(sol.id, item)}
              >
                Soru {idx + 1}
                {sol.mistakeKind === "wrong"
                  ? " · Yanlış"
                  : sol.mistakeKind === "blank"
                    ? " · Boş"
                    : ""}
              </button>
            ))}
            {item.knowledgeCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className="notal-topic-solution-btn"
                onClick={() => onOpenCard(card.id, item)}
              >
                Kart
              </button>
            ))}
          </div>
        ) : null}
      </li>
    );
  }

  const visibleAnalyses =
    listTab === "general" ? generalAnalyses : branchAnalyses;

  return (
    <section className="notal-trial-analysis" aria-label="Deneme analizi">
      <div className="notal-trial-analysis-header">
        <h2 className="notal-yks-topics-title">Deneme Analizi</h2>
      </div>

      <div className="notal-trial-layout">
        <form className="notal-trial-form" onSubmit={handleSubmit}>
          <div
            className="notal-trial-kind-tabs"
            role="group"
            aria-label="Deneme türü"
          >
            <button
              type="button"
              className={`notal-trial-kind-btn${kind === "general" ? " is-active" : ""}`}
              onClick={() => setKind("general")}
              disabled={submitting}
            >
              Genel deneme
            </button>
            <button
              type="button"
              className={`notal-trial-kind-btn${kind === "branch" ? " is-active" : ""}`}
              onClick={() => setKind("branch")}
              disabled={submitting}
            >
              Branş denemesi
            </button>
          </div>

          <div className="notal-trial-form-grid">
            <label className="notal-trial-field">
              <span>Sınav</span>
              <select
                value={exam}
                onChange={(event) => {
                  setExam(event.target.value as YksExam);
                  setBranch("");
                  setBranchDrafts({});
                }}
                disabled={submitting}
              >
                {enabledExams.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            {kind === "branch" ? (
              <label className="notal-trial-field">
                <span>Branş</span>
                <select
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  disabled={submitting || branches.length === 0}
                  required
                >
                  <option value="">Seç…</option>
                  {branches.map((item) => (
                    <option key={item} value={item}>
                      {item}
                      {getBranchQuestionCount(exam, item, yksArea)
                        ? ` (${getBranchQuestionCount(exam, item, yksArea)} soru)`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="notal-trial-field">
              <span>Deneme adı (opsiyonel)</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Örn. 3. Kurumsal"
                disabled={submitting}
                maxLength={80}
              />
            </label>

            <label className="notal-trial-field">
              <span>
                Yanlış sayısı
                <em className="notal-trial-field-hint">
                  {questionCountForNet ? ` · ${questionCountForNet} soru` : ""}
                </em>
              </span>
              <input
                type="number"
                min={0}
                value={wrongCount}
                onChange={(event) => setWrongCount(event.target.value)}
                disabled={submitting}
              />
            </label>

            <label className="notal-trial-field">
              <span>Boş sayısı</span>
              <input
                type="number"
                min={0}
                value={blankCount}
                onChange={(event) => setBlankCount(event.target.value)}
                disabled={submitting}
              />
            </label>
          </div>

          {computedNetPreview !== null ? (
            <p className="notal-trial-net-preview">
              Hesaplanan net: <strong>{computedNetPreview}</strong>
            </p>
          ) : null}

          {kind === "general" && branches.length > 0 ? (
            <div className="notal-trial-branch-stats">
              <button
                type="button"
                className="notal-trial-branch-toggle"
                onClick={() => setShowBranchStats((open) => !open)}
                disabled={submitting}
              >
                {showBranchStats
                  ? "Branş detaylarını gizle"
                  : "Branş yanlış / boş ekle (opsiyonel)"}
              </button>

              {showBranchStats ? (
                <div
                  className="notal-trial-branch-table"
                  role="group"
                  aria-label="Branş detayları"
                >
                  <div className="notal-trial-branch-row notal-trial-branch-row--head">
                    <span>Branş</span>
                    <span>Yanlış</span>
                    <span>Boş</span>
                    <span>Net</span>
                  </div>
                  {branches.map((branchName) => {
                    const q = getBranchQuestionCount(exam, branchName, yksArea);
                    const draft = branchDrafts[branchName] ?? {
                      wrongCount: "",
                      blankCount: "",
                    };
                    const w = parseOptionalCount(draft.wrongCount);
                    const b = parseOptionalCount(draft.blankCount);
                    const rowNet =
                      q !== null &&
                      w !== null &&
                      b !== null &&
                      !Number.isNaN(w) &&
                      !Number.isNaN(b)
                        ? computeNetFromWrongBlank(q, w, b)
                        : null;
                    return (
                      <div key={branchName} className="notal-trial-branch-row">
                        <span className="notal-trial-branch-name">
                          {branchName}
                          {q ? <small>{q} soru</small> : null}
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={draft.wrongCount}
                          onChange={(event) =>
                            updateBranchDraft(
                              branchName,
                              "wrongCount",
                              event.target.value,
                            )
                          }
                          placeholder="—"
                          disabled={submitting}
                          aria-label={`${branchName} yanlış`}
                        />
                        <input
                          type="number"
                          min={0}
                          value={draft.blankCount}
                          onChange={(event) =>
                            updateBranchDraft(
                              branchName,
                              "blankCount",
                              event.target.value,
                            )
                          }
                          placeholder="—"
                          disabled={submitting}
                          aria-label={`${branchName} boş`}
                        />
                        <span className="notal-trial-branch-net">
                          {rowNet?.ok ? rowNet.net : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="notal-trial-attachments">
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={(event) => {
                void handleFiles(event.target.files);
              }}
              disabled={submitting}
            />
            <button
              type="button"
              className="notal-trial-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={
                submitting || photos.length >= MAX_TRIAL_ANALYSIS_IMAGES
              }
            >
              Soru fotoğrafı ekle
            </button>
            <span className="notal-trial-attach-hint">
              Fotoğrafları ekle, her biri için Yanlış veya Boş seç, sonra
              gönder.
            </span>

            {photos.length ? (
              <ul
                className="notal-trial-photo-list"
                aria-label="Eklenecek soru fotoğrafları"
              >
                {photos.map((item, index) => (
                  <li
                    key={item.attachment.id}
                    className="notal-trial-photo-item"
                  >
                    <div className="notal-trial-photo-preview">
                      <img
                        src={item.attachment.previewUrl}
                        alt={item.attachment.name}
                      />
                      <span className="notal-trial-photo-index">
                        {index + 1}
                      </span>
                    </div>
                    <div className="notal-trial-photo-meta">
                      <span className="notal-trial-photo-name">
                        {item.attachment.name}
                      </span>
                      <div
                        className="notal-trial-photo-kind"
                        role="group"
                        aria-label={`${item.attachment.name} soru türü`}
                      >
                        <button
                          type="button"
                          className={`notal-trial-photo-kind-btn${item.mistakeKind === "wrong" ? " is-active is-wrong" : ""}`}
                          onClick={() =>
                            setPhotos((prev) =>
                              prev.map((row) =>
                                row.attachment.id === item.attachment.id
                                  ? { ...row, mistakeKind: "wrong" }
                                  : row,
                              ),
                            )
                          }
                          disabled={submitting}
                        >
                          Yanlış
                        </button>
                        <button
                          type="button"
                          className={`notal-trial-photo-kind-btn${item.mistakeKind === "blank" ? " is-active is-blank" : ""}`}
                          onClick={() =>
                            setPhotos((prev) =>
                              prev.map((row) =>
                                row.attachment.id === item.attachment.id
                                  ? { ...row, mistakeKind: "blank" }
                                  : row,
                              ),
                            )
                          }
                          disabled={submitting}
                        >
                          Boş
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="notal-trial-photo-remove"
                      onClick={() =>
                        setPhotos((prev) =>
                          prev.filter(
                            (row) => row.attachment.id !== item.attachment.id,
                          ),
                        )
                      }
                      disabled={submitting}
                      aria-label={`${item.attachment.name} kaldır`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {error ? <p className="notal-trial-error">{error}</p> : null}

          <button
            type="submit"
            className="notal-trial-submit"
            disabled={submitting}
          >
            {submitting
              ? photos.length
                ? "Analiz ediliyor…"
                : "Kaydediliyor…"
              : photos.length
                ? "Gönder ve analiz et"
                : "Deneme analizini kaydet"}
          </button>
        </form>

        <aside className="notal-trial-lists" aria-label="Kayıtlı denemeler">
          <div
            className="notal-trial-list-tabs"
            role="tablist"
            aria-label="Deneme listesi türü"
          >
            <button
              type="button"
              role="tab"
              aria-selected={listTab === "general"}
              className={`notal-trial-list-tab${listTab === "general" ? " is-active" : ""}`}
              onClick={() => setListTab("general")}
            >
              Genel
              <span className="notal-trial-list-tab-count">
                {generalAnalyses.length}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={listTab === "branch"}
              className={`notal-trial-list-tab${listTab === "branch" ? " is-active" : ""}`}
              onClick={() => setListTab("branch")}
            >
              Branş
              <span className="notal-trial-list-tab-count">
                {branchAnalyses.length}
              </span>
            </button>
          </div>

          {visibleAnalyses.length === 0 ? (
            <p className="notal-yks-topics-empty">
              {listTab === "general"
                ? "Henüz genel deneme yok."
                : "Henüz branş denemesi yok."}
            </p>
          ) : (
            <ul className="notal-trial-list">
              {visibleAnalyses.map((item) => renderAnalysisItem(item))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
