"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import RekabetliLogo from "@/components/RekabetliLogo";
import NotalMark from "@/components/NotalMark";
import type { NotalCreditsState } from "@/lib/notal-credits-shared";
import {
  DIFFICULTY_LABELS,
  NOTAL_DIFFICULTIES,
  type NotalDifficulty,
} from "@/lib/notal-difficulty";
import { ensureNotalVisitorCookie, notalFetch } from "@/lib/notal-visitor-id";
import {
  NOTAL_MAX_TOPIC_CHARS,
  NOTAL_MAX_TOPIC_WORDS,
  clampNotalTopicInput,
  countNotalTopicWords,
  notalTopicWordLimitError,
} from "@/lib/notal-topic-limits";

export default function NotAlGenerator() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<NotalDifficulty>("zor");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<NotalCreditsState | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(true);

  const refreshCredits = useCallback(async () => {
    try {
      await ensureNotalVisitorCookie();
      const res = await notalFetch("/api/notal/credits");
      if (res.ok) {
        const data = (await res.json()) as NotalCreditsState;
        setCredits(data);
      }
    } catch {
      /* hak bilgisi yüklenemezse UI yine çalışır */
    } finally {
      setCreditsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCredits();
  }, [refreshCredits]);

  function goToDonation() {
    router.push("/notal/bagis");
  }

  async function handleGenerate() {
    const trimmed = topic.trim();
    if (!trimmed || isLoading) return;

    if (countNotalTopicWords(trimmed) > NOTAL_MAX_TOPIC_WORDS) {
      setError(notalTopicWordLimitError());
      return;
    }

    if (credits && !credits.canGenerate) {
      goToDonation();
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await notalFetch("/api/notal", {
        method: "POST",
        body: JSON.stringify({
          topic: trimmed,
          difficulty,
        }),
      });

      const data = (await response.json()) as {
        noteId?: string;
        error?: string;
        code?: string;
        credits?: NotalCreditsState;
      };

      if (response.status === 403 && data.code === "no_credits") {
        if (data.credits) setCredits(data.credits);
        goToDonation();
        return;
      }

      if (!response.ok) {
        setError(data.error ?? "Not üretilemedi. Lütfen tekrar dene.");
        return;
      }

      if (data.credits) setCredits(data.credits);
      else void refreshCredits();

      if (data.noteId) {
        router.push(`/notal/notlar/${data.noteId}`);
        return;
      }

      setError("Not kaydedildi ancak yönlendirme yapılamadı.");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar dene.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleGenerate();
  }

  const creditLabel = creditsLoading
    ? "…"
    : credits
      ? `${credits.notesRemaining}/${credits.notesMax}`
      : "—";

  const noCredits =
    !creditsLoading && credits !== null && !credits.canGenerate;

  const topicWordCount = countNotalTopicWords(topic);
  const topicOverWordLimit = topicWordCount > NOTAL_MAX_TOPIC_WORDS;

  function handleTopicChange(value: string) {
    setTopic(clampNotalTopicInput(value));
    if (error === notalTopicWordLimitError()) setError(null);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-10 text-center">
        <div className="mb-3 flex justify-center">
          <RekabetliLogo href="/" />
        </div>
        <h1 className="flex flex-wrap items-center justify-center gap-2 text-3xl font-semibold tracking-tight text-rekabetli-text sm:text-4xl">
          <NotalMark className="text-3xl sm:text-4xl" />
          <span className="rounded-full border border-rekabetli-action/40 bg-rekabetli-action/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-rekabetli-action">
            Demo
          </span>
        </h1>
        <p className="mt-3 text-sm text-rekabetli-muted sm:text-base">
          Olimpiyat arşivinden konu bazlı özet notlar — çıkmış sorularla destekli.
        </p>
      </header>

      <section className="rounded-2xl border border-rekabetli-border bg-rekabetli-surface/80 p-5 shadow-[0_12px_30px_rgba(2,8,18,0.4)] backdrop-blur-sm sm:p-6">
        {noCredits && credits?.grantLimitReached && (
          <div
            className="mb-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-4"
            role="status"
          >
            <p className="text-sm font-semibold text-amber-100">
              Tüm demo hak paketlerinizi kullandınız
            </p>
            <p className="mt-2 text-sm leading-relaxed text-amber-200/90">
              NotAl şu an geliştirme aşamasında; en fazla 5 PDF bağışı karşılığı
              not hakkı tanımlanabiliyor. Yine de kütüphaneye PDF
              ekleyebilirsiniz — topluluğa katkınız arşivde kalır.
            </p>
            <Link
              href="/notal/bagis"
              className="mt-3 inline-flex text-sm font-medium text-amber-100 underline underline-offset-2 hover:text-white"
            >
              Yine de PDF bağışla →
            </Link>
          </div>
        )}

        {noCredits && credits && !credits.grantLimitReached && (
          <div
            className="mb-4 rounded-xl border border-rekabetli-primary/35 bg-rekabetli-primary/10 px-4 py-4"
            role="status"
          >
            <p className="text-sm font-semibold text-rekabetli-text">
              Not oluşturmak için önce kütüphaneye katkı verin
            </p>
            <p className="mt-2 text-sm leading-relaxed text-rekabetli-muted">
              Demo sürümde not üretmek için{" "}
              <strong className="font-medium text-rekabetli-text">
                dijital metin içeren bir PDF
              </strong>{" "}
              bağışlamanız gerekir. Her başarılı bağış{" "}
              <strong className="font-medium text-rekabetli-primary">
                3 not hakkı
              </strong>{" "}
              tanımlar (en fazla 5 paket).
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-rekabetli-muted">
              <li>
                <Link
                  href="/notal/bagis"
                  className="font-medium text-rekabetli-primary underline underline-offset-2"
                >
                  PDF Bağışla
                </Link>{" "}
                sayfasına gidin
              </li>
              <li>Ders notunuzu, kitap kesitini veya çıkmış soru PDF&apos;inizi yükleyin</li>
              <li>Yükleme bitince 3/3 hak tanımlanır — buradan not üretebilirsiniz</li>
            </ol>
            <Link
              href="/notal/bagis"
              className="mt-4 inline-flex rounded-lg bg-rekabetli-primary px-4 py-2 text-sm font-semibold text-white shadow-md shadow-rekabetli-primary/25 transition hover:bg-rekabetli-primary-strong"
            >
              PDF bağışla ve hak kazan
            </Link>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex flex-1 flex-col gap-2">
            <input
              type="text"
              value={topic}
              onChange={(e) => handleTopicChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                noCredits
                  ? "Not üretmek için önce PDF bağışlayın…"
                  : "Örn: Kepler Kanunları, Hücresel Solunum..."
              }
              disabled={isLoading || noCredits}
              maxLength={NOTAL_MAX_TOPIC_CHARS}
              aria-describedby="notal-topic-word-count"
              className="w-full rounded-xl border border-rekabetli-border bg-rekabetli-bg-soft px-4 py-3 text-sm text-rekabetli-text placeholder:text-rekabetli-muted/70 outline-none transition focus:border-rekabetli-primary/60 focus:ring-2 focus:ring-rekabetli-primary/20 disabled:opacity-60"
            />
            <p
              id="notal-topic-word-count"
              className={`text-right text-xs tabular-nums ${
                topicOverWordLimit
                  ? "text-red-400"
                  : "text-rekabetli-muted/80"
              }`}
            >
              {topicWordCount}/{NOTAL_MAX_TOPIC_WORDS} kelime
            </p>
          </div>
          <div className="flex flex-col items-stretch sm:items-center">
            <button
              type="button"
              onClick={noCredits ? goToDonation : handleGenerate}
              disabled={
                isLoading || (!noCredits && (!topic.trim() || topicOverWordLimit))
              }
              className="rounded-xl bg-rekabetli-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-rekabetli-primary/20 transition hover:bg-rekabetli-primary-strong disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[120px]"
            >
              {isLoading ? "..." : noCredits ? "PDF Bağışla" : "NotAl"}
            </button>
            <p
              className="mt-1.5 text-center text-xs tabular-nums text-rekabetli-muted"
              aria-live="polite"
            >
              Kalan hak:{" "}
              <span className="font-semibold text-rekabetli-primary">
                {creditLabel}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-sm font-medium text-rekabetli-text">
            Anlatım derinliği
          </p>
          <div
            className="grid grid-cols-3 gap-2"
            role="radiogroup"
            aria-label="Anlatım derinliği"
          >
            {NOTAL_DIFFICULTIES.map((level) => {
              const active = difficulty === level;
              const { label, hint } = DIFFICULTY_LABELS[level];
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={isLoading || noCredits}
                  onClick={() => setDifficulty(level)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${
                    active
                      ? "border-rekabetli-primary bg-rekabetli-primary/15 ring-2 ring-rekabetli-primary/30"
                      : "border-rekabetli-border bg-rekabetli-bg-soft/60 hover:border-rekabetli-primary/40"
                  } disabled:opacity-60`}
                >
                  <span
                    className={`block text-sm font-semibold ${
                      active ? "text-rekabetli-primary" : "text-rekabetli-text"
                    }`}
                  >
                    {label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-rekabetli-muted">
                    {hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-rekabetli-muted/90">
          📚 PDF bağışı = 3 not hakkı (en fazla 5 paket).{" "}
          <Link
            href="/notal/bagis"
            className="text-rekabetli-primary underline decoration-rekabetli-primary/40 underline-offset-2 hover:text-rekabetli-primary-strong"
          >
            Kütüphaneye katkı
          </Link>
        </p>
      </section>

      <section className="mt-8 flex-1">
        {isLoading && (
          <div className="flex items-center gap-3 rounded-xl border border-rekabetli-border bg-rekabetli-surface/50 px-5 py-4">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-rekabetli-primary border-t-transparent" />
            <p className="text-sm text-rekabetli-muted">
              Arşiv taranıyor, alan belirleniyor,{" "}
              {DIFFICULTY_LABELS[difficulty].label} düzeyinde not
              hazırlanıyor…
            </p>
          </div>
        )}

        {!isLoading && error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {!isLoading && !error && (
          <p className="text-center text-sm text-rekabetli-muted/60">
            Not hazır olunca otomatik olarak not sayfasına yönlendirileceksiniz.
          </p>
        )}
      </section>
    </div>
  );
}
