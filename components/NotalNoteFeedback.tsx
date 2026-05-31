"use client";

import { useCallback, useEffect, useState } from "react";
import type { NotalNoteFeedbackSummary } from "@/lib/notal-feedback-shared";
import { formatRatingAvg } from "@/lib/notal-feedback-shared";
import { ensureNotalVisitorCookie, notalFetch } from "@/lib/notal-visitor-id";

const MIN_SCORE = 1;
const MAX_SCORE = 5;

interface NotalNoteFeedbackProps {
  noteId: string;
}

function scoreTitle(score: number): string {
  if (score === 1) return "1 — Az faydalı";
  if (score === 5) return "5 — Çok faydalı";
  return `${score} puan`;
}

export default function NotalNoteFeedback({ noteId }: NotalNoteFeedbackProps) {
  const [summary, setSummary] = useState<NotalNoteFeedbackSummary | null>(null);
  const [draftScore, setDraftScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadFeedback = useCallback(async () => {
    try {
      await ensureNotalVisitorCookie();
      const res = await notalFetch(`/api/notal/notes/${noteId}/feedback`);
      const data = (await res.json()) as {
        feedback?: NotalNoteFeedbackSummary;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Geri bildirim yüklenemedi.");
        return;
      }
      const fb = data.feedback ?? null;
      setSummary(fb);
      setDraftScore(fb?.myScore ?? null);
      setComment(fb?.myComment ?? "");
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  async function submitScore(score: number) {
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await notalFetch(`/api/notal/notes/${noteId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ score, comment: comment.trim() || undefined }),
      });
      const data = (await res.json()) as {
        feedback?: NotalNoteFeedbackSummary;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Puan kaydedilemedi.");
        return;
      }
      setSummary(data.feedback ?? null);
      setDraftScore(data.feedback?.myScore ?? score);
      setSaved(true);
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitComment() {
    const trimmed = comment.trim();
    if (!trimmed && draftScore == null) {
      setError("Puan verin veya geri bildirim yazın.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await notalFetch(`/api/notal/notes/${noteId}/feedback`, {
        method: "POST",
        body: JSON.stringify({
          score: draftScore ?? undefined,
          comment: trimmed,
        }),
      });
      const data = (await res.json()) as {
        feedback?: NotalNoteFeedbackSummary;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Geri bildirim kaydedilemedi.");
        return;
      }
      setSummary(data.feedback ?? null);
      setComment(data.feedback?.myComment ?? trimmed);
      setSaved(true);
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setSubmitting(false);
    }
  }

  const ratingCount = summary?.ratingCount ?? 0;
  const ratingAvg = summary?.ratingAvg ?? null;

  return (
    <div className="answer-rating-block notal-note-feedback">
      <div className="answer-rating-head">
        <span className="answer-rating-label">Bu not ne kadar faydalı?</span>
        <span className="answer-rating-summary" aria-live="polite">
          {ratingCount === 0 ? (
            "Henüz puan yok"
          ) : (
            <>
              Ortalama{" "}
              <strong className="answer-rating-avg">
                {formatRatingAvg(ratingAvg)}
              </strong>
              {` / 5 · ${ratingCount} değerlendirme`}
            </>
          )}
        </span>
      </div>

      {loading ? (
        <p className="answer-rating-hint">Geri bildirim yükleniyor…</p>
      ) : (
        <>
          <div className="answer-rating-controls">
            <div
              className="answer-rating-stars"
              role="group"
              aria-label="Faydalılık puanı ver"
            >
              {Array.from({ length: MAX_SCORE - MIN_SCORE + 1 }, (_, i) => {
                const score = MIN_SCORE + i;
                const selected = draftScore === score;
                return (
                  <button
                    key={score}
                    type="button"
                    className={`answer-rating-star${selected ? " is-selected" : ""}`}
                    title={scoreTitle(score)}
                    aria-label={`${score} puan`}
                    aria-pressed={selected}
                    disabled={submitting}
                    onClick={() => {
                      setDraftScore(score);
                      void submitScore(score);
                    }}
                  >
                    <span className="answer-rating-star-num">{score}</span>
                  </button>
                );
              })}
            </div>
            {draftScore != null && (
              <span className="answer-rating-yours">
                Sizin puanınız: {draftScore}
              </span>
            )}
          </div>

          <div className="notal-feedback-comment">
            <label
              htmlFor={`notal-feedback-${noteId}`}
              className="notal-feedback-comment-label"
            >
              Geri bildiriminiz (isteğe bağlı)
            </label>
            <textarea
              id={`notal-feedback-${noteId}`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1200}
              rows={3}
              placeholder="Not hakkında düşüncelerinizi yazın…"
              className="notal-feedback-comment-input"
              disabled={submitting}
            />
            <div className="notal-feedback-comment-actions">
              <button
                type="button"
                className="notal-feedback-submit"
                disabled={submitting}
                onClick={() => void submitComment()}
              >
                {submitting ? "Kaydediliyor…" : "Geri bildirimi kaydet"}
              </button>
              {saved && (
                <span className="notal-feedback-saved" role="status">
                  Kaydedildi
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {error && <p className="notal-feedback-error">{error}</p>}
    </div>
  );
}
