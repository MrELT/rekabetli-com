"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import {
  fileToPendingAttachment,
  toAttachmentInput,
  type PendingChatAttachment,
} from "@/lib/notal/chat-attachments";
import type { NotalStudentProfile, YksArea, YksExam } from "@/lib/notal/student-context";
import {
  formatTrialAnalysisSummary,
  MAX_TRIAL_ANALYSIS_IMAGES,
  type NotalTrialAnalysis,
  type TrialAnalysisKind,
} from "@/lib/notal/trial-analysis";
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
  const [net, setNet] = useState("");
  const [wrongCount, setWrongCount] = useState("");
  const [blankCount, setBlankCount] = useState("");
  const [attachments, setAttachments] = useState<PendingChatAttachment[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const branches = useMemo(() => {
    return getFilteredYksTopics(exam, yksArea, { ydsEnabled }).branches.map(
      (item) => item.name,
    );
  }, [exam, yksArea, ydsEnabled]);

  const generalAnalyses = analyses.filter((item) => item.kind === "general");
  const branchAnalyses = analyses.filter((item) => item.kind === "branch");
  const latest = analyses[0] ?? null;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const next = [...attachments];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_TRIAL_ANALYSIS_IMAGES) {
        setError(`En fazla ${MAX_TRIAL_ANALYSIS_IMAGES} görsel ekleyebilirsin.`);
        break;
      }
      try {
        const pending = await fileToPendingAttachment(file);
        if (pending.kind !== "image") {
          setError("Deneme analizi için yalnızca görsel ekleyebilirsin.");
          continue;
        }
        next.push(pending);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Dosya eklenemedi.");
      }
    }
    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (kind === "branch" && !branch) {
      setError("Branş denemesi için branş seçmelisin.");
      return;
    }

    const netValue = net.trim() ? Number(net.trim().replace(",", ".")) : null;
    if (net.trim() && !Number.isFinite(netValue)) {
      setError("Net değeri geçersiz.");
      return;
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
        wrongCount: wrongCount.trim() ? Number(wrongCount) : null,
        blankCount: blankCount.trim() ? Number(blankCount) : null,
        attachments: attachments.map(toAttachmentInput),
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
      setNet("");
      setWrongCount("");
      setBlankCount("");
      setAttachments([]);
      setBranch("");
    } catch {
      setError("Deneme analizi kaydedilemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="notal-trial-analysis" aria-label="Deneme analizi">
      <div className="notal-trial-analysis-header">
        <h2 className="notal-yks-topics-title">Deneme Analizi</h2>
        {latest ? (
          <p className="notal-trial-latest">
            Son deneme: <strong>{latest.name}</strong> ·{" "}
            {formatTrialAnalysisSummary(latest)}
          </p>
        ) : (
          <p className="notal-trial-latest">Henüz kayıtlı deneme analizi yok.</p>
        )}
      </div>

      <form className="notal-trial-form" onSubmit={handleSubmit}>
        <div className="notal-trial-kind-tabs" role="group" aria-label="Deneme türü">
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
            <span>{kind === "branch" ? "Branş neti" : `${exam} neti`}</span>
            <input
              type="text"
              inputMode="decimal"
              value={net}
              onChange={(event) => setNet(event.target.value)}
              placeholder="Örn. 28.5"
              disabled={submitting}
            />
          </label>

          <label className="notal-trial-field">
            <span>Yanlış sayısı</span>
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
              submitting || attachments.length >= MAX_TRIAL_ANALYSIS_IMAGES
            }
          >
            Yanlış / boş soru fotoğrafı ekle
          </button>
          <span className="notal-trial-attach-hint">
            Görsel varsa Luna soruları çözer ve bilgi kartı üretir.
          </span>

          {attachments.length ? (
            <div className="notal-compose-attachments">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="notal-compose-attachment">
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    className="notal-compose-attachment-thumb"
                  />
                  <span className="notal-compose-attachment-name">
                    {attachment.name}
                  </span>
                  <button
                    type="button"
                    className="notal-compose-attachment-remove"
                    onClick={() =>
                      setAttachments((prev) =>
                        prev.filter((item) => item.id !== attachment.id),
                      )
                    }
                    disabled={submitting}
                    aria-label={`${attachment.name} kaldır`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {error ? <p className="notal-trial-error">{error}</p> : null}

        <button
          type="submit"
          className="notal-trial-submit"
          disabled={submitting}
        >
          {submitting
            ? attachments.length
              ? "Analiz ediliyor…"
              : "Kaydediliyor…"
            : "Deneme analizini kaydet"}
        </button>
      </form>

      <div className="notal-trial-lists">
        <section className="notal-trial-list-panel" aria-label="Genel denemeler">
          <h3 className="notal-trial-list-title">Genel Denemeler</h3>
          {generalAnalyses.length === 0 ? (
            <p className="notal-yks-topics-empty">Henüz genel deneme yok.</p>
          ) : (
            <ul className="notal-trial-list">
              {generalAnalyses.map((item, index) => (
                <li key={item.id} className="notal-trial-list-item">
                  <div className="notal-trial-list-main">
                    <strong>
                      {item.name}
                      {index === 0 && latest?.id === item.id ? (
                        <span className="notal-trial-badge">Son</span>
                      ) : null}
                    </strong>
                    <span>{formatTrialAnalysisSummary(item)}</span>
                    {(item.wrongCount !== null || item.blankCount !== null) && (
                      <small>
                        {item.wrongCount !== null
                          ? `${item.wrongCount} yanlış`
                          : null}
                        {item.wrongCount !== null && item.blankCount !== null
                          ? " · "
                          : null}
                        {item.blankCount !== null
                          ? `${item.blankCount} boş`
                          : null}
                      </small>
                    )}
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
              ))}
            </ul>
          )}
        </section>

        <section className="notal-trial-list-panel" aria-label="Branş denemeleri">
          <h3 className="notal-trial-list-title">Branş Denemeleri</h3>
          {branchAnalyses.length === 0 ? (
            <p className="notal-yks-topics-empty">Henüz branş denemesi yok.</p>
          ) : (
            <ul className="notal-trial-list">
              {branchAnalyses.map((item, index) => (
                <li key={item.id} className="notal-trial-list-item">
                  <div className="notal-trial-list-main">
                    <strong>
                      {item.name}
                      {index === 0 && latest?.id === item.id ? (
                        <span className="notal-trial-badge">Son</span>
                      ) : null}
                    </strong>
                    <span>{formatTrialAnalysisSummary(item)}</span>
                    {(item.wrongCount !== null || item.blankCount !== null) && (
                      <small>
                        {item.wrongCount !== null
                          ? `${item.wrongCount} yanlış`
                          : null}
                        {item.wrongCount !== null && item.blankCount !== null
                          ? " · "
                          : null}
                        {item.blankCount !== null
                          ? `${item.blankCount} boş`
                          : null}
                      </small>
                    )}
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
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
