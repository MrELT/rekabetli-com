"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { chunkText, isLowQualityChunk, splitIntoBatches } from "@/lib/pdf-chunking";
import { extractPdfInBrowser } from "@/lib/pdf-client-extract";
import { isExamDocumentType } from "@/lib/pdf-exam-detect";
import type { PdfMetadataJson } from "@/lib/pdf-metadata-map";
import { EMBED_BATCH_SIZE } from "@/lib/pdf-ingest-shared";
import {
  createSupabaseBrowserClient,
  uploadPdfToAcademicBucket,
} from "@/lib/supabase-browser";
import { ensureNotalVisitorCookie, notalFetch } from "@/lib/notal-visitor-id";

function createIngestKey(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `ing_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

type PipelineStep = "quality" | "ai" | "cloud" | "embed" | "done";

type Phase = "idle" | "running" | "success" | "error";

const STEPS: { id: PipelineStep; label: string }[] = [
  { id: "quality", label: "Kalite kontrol ediliyor…" },
  { id: "ai", label: "Yapay zeka analiz ediyor…" },
  { id: "cloud", label: "Buluta yükleniyor…" },
  { id: "embed", label: "Arşive aktarılıyor…" },
];

const STEP_PROGRESS: Record<PipelineStep, number> = {
  quality: 12,
  ai: 32,
  cloud: 48,
  embed: 55,
  done: 100,
};

export default function PdfDonationForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeStep, setActiveStep] = useState<PipelineStep | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusLabel, setStatusLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<PdfMetadataJson | null>(null);
  const [chunkTotal, setChunkTotal] = useState(0);
  const [embedBatch, setEmbedBatch] = useState(0);
  const [embedBatchTotal, setEmbedBatchTotal] = useState(0);

  const isBusy = phase === "running";

  const resetUi = useCallback(() => {
    setPhase("idle");
    setActiveStep(null);
    setProgress(0);
    setStatusLabel("");
    setMessage(null);
    setMetadata(null);
    setChunkTotal(0);
    setEmbedBatch(0);
    setEmbedBatchTotal(0);
  }, []);

  async function uploadToStorage(pdfFile: File): Promise<string> {
    const browserClient = createSupabaseBrowserClient();
    if (browserClient) {
      const { pdf_url } = await uploadPdfToAcademicBucket(pdfFile);
      return pdf_url;
    }

    const form = new FormData();
    form.append("file", pdfFile);
    const res = await fetch("/api/pdf-upload", { method: "POST", body: form });
    const data = (await res.json()) as { pdf_url?: string; error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? "PDF buluta yüklenemedi.");
    }
    if (!data.pdf_url) {
      throw new Error("Yükleme URL'si alınamadı.");
    }
    return data.pdf_url;
  }

  const runPipeline = useCallback(
    async (pdfFile: File) => {
      abortRef.current = false;
      setPhase("running");
      setMessage(null);
      setMetadata(null);
      setChunkTotal(0);
      setEmbedBatch(0);
      setEmbedBatchTotal(0);

      try {
        await ensureNotalVisitorCookie();
        const ingestKey = createIngestKey();

        setActiveStep("quality");
        setStatusLabel(STEPS[0].label);
        setProgress(STEP_PROGRESS.quality);

        const extracted = await extractPdfInBrowser(pdfFile);
        if (abortRef.current) return;

        setActiveStep("ai");
        setStatusLabel(STEPS[1].label);
        setProgress(STEP_PROGRESS.ai);

        const metaRes = await fetch("/api/pdf-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: extracted.previewText }),
        });
        const metaData = (await metaRes.json()) as PdfMetadataJson & {
          error?: string;
        };
        if (!metaRes.ok) {
          throw new Error(metaData.error ?? "Metadata çıkarılamadı.");
        }
        setMetadata(metaData);
        if (abortRef.current) return;

        setActiveStep("cloud");
        setStatusLabel(STEPS[2].label);
        setProgress(STEP_PROGRESS.cloud);

        const pdfUrl = await uploadToStorage(pdfFile);
        if (abortRef.current) return;

        const examMode =
          extracted.examMode || isExamDocumentType(metaData.type);
        const minChunkLen = examMode ? 40 : 80;

        const chunks = chunkText(extracted.fullText).filter(
          (c) => c.length >= minChunkLen && !isLowQualityChunk(c, examMode),
        );
        if (!chunks.length) {
          throw new Error(
            examMode
              ? "Çıkmış soru metni parçalara ayrılamadı. PDF'de metin katmanı çok seyrek olabilir."
              : "Metin parçalara ayrılamadı.",
          );
        }

        setChunkTotal(chunks.length);
        const batches = splitIntoBatches(chunks, EMBED_BATCH_SIZE);
        setEmbedBatchTotal(batches.length);

        setActiveStep("embed");
        setStatusLabel(STEPS[3].label);
        setProgress(STEP_PROGRESS.embed);

        let totalInserted = 0;
        const embedSpan = 100 - STEP_PROGRESS.embed;

        for (let i = 0; i < batches.length; i++) {
          if (abortRef.current) return;
          setEmbedBatch(i + 1);
          setStatusLabel(`Arşive aktarılıyor… (${i + 1}/${batches.length} parti)`);
          setProgress(
            Math.round(STEP_PROGRESS.embed + ((i + 0.5) / batches.length) * embedSpan),
          );

          const embedRes = await notalFetch("/api/pdf-embed", {
            method: "POST",
            body: JSON.stringify({
              chunks: batches[i],
              title: metaData.title,
              author: metaData.author,
              category: metaData.category,
              type: metaData.type,
              pdf_url: pdfUrl,
              file_name: pdfFile.name,
              chunk_offset: i * EMBED_BATCH_SIZE,
              total_chunks: chunks.length,
              ingest_key: ingestKey,
            }),
          });

          const embedData = (await embedRes.json()) as {
            inserted?: number;
            error?: string;
          };
          if (!embedRes.ok) {
            throw new Error(
              embedData.error ?? `Parti ${i + 1} kaydedilemedi.`,
            );
          }
          totalInserted += embedData.inserted ?? batches[i].length;
          setProgress(
            Math.round(STEP_PROGRESS.embed + ((i + 1) / batches.length) * embedSpan),
          );
        }

        setActiveStep("done");
        setProgress(100);
        setPhase("success");
        setStatusLabel("Tamamlandı");

        let grantMessage = "";
        try {
          const grantRes = await notalFetch("/api/notal/grant", {
            method: "POST",
            body: JSON.stringify({ ingestKey }),
          });
          const grantData = (await grantRes.json()) as {
            granted?: boolean;
            message?: string;
          };
          if (grantRes.ok && grantData.message) {
            grantMessage = ` ${grantData.message}`;
          }
        } catch {
          grantMessage =
            " Not hakları güncellenemedi; NotAl sayfasını yenileyin.";
        }

        setMessage(
          `"${metaData.title}" (${metaData.author}) — ${totalInserted} parça kütüphaneye eklendi.${grantMessage}`,
        );
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
      } catch (err) {
        if (abortRef.current) return;
        setPhase("error");
        setActiveStep(null);
        setProgress(0);
        setStatusLabel("");
        setMessage(
          err instanceof Error ? err.message : "Beklenmeyen bir hata oluştu.",
        );
      }
    },
    [],
  );

  const pickFile = useCallback(
    (next: File | null) => {
      if (!next) {
        setFile(null);
        resetUi();
        return;
      }
      if (
        !next.name.toLowerCase().endsWith(".pdf") ||
        next.type !== "application/pdf"
      ) {
        setPhase("error");
        setMessage("Yalnızca PDF dosyaları yüklenebilir.");
        setProgress(0);
        return;
      }
      if (next.size > 50 * 1024 * 1024) {
        setPhase("error");
        setMessage("Dosya boyutu en fazla 50 MB olabilir.");
        setProgress(0);
        return;
      }
      setFile(next);
      void runPipeline(next);
    },
    [resetUi, runPipeline],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) pickFile(dropped);
  }

  function handleCancel() {
    abortRef.current = true;
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
    resetUi();
  }

  const stepIndex = activeStep
    ? STEPS.findIndex((s) => s.id === activeStep)
    : -1;

  return (
    <div className="mx-auto flex max-w-2xl flex-col px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-10 text-center">
        <p className="mb-2 text-sm font-medium uppercase tracking-widest text-rekabetli-action">
          Rekabetli Kütüphanesi
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-rekabetli-text sm:text-4xl">
          Kütüphaneye Katkıda Bulun
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-rekabetli-muted sm:text-base">
          Ders kitabı, sunum veya çıkmış soru PDF&apos;inizi paylaşın. Dosyanız
          kütüphaneye eklenir; her başarılı bağış 3 NotAl hakkı kazandırır.
        </p>
        <Link
          href="/notal"
          className="mt-4 inline-block text-sm text-rekabetli-primary hover:underline"
        >
          ← NotAl&apos;a dön
        </Link>
      </header>

      <div className="space-y-6 rounded-2xl border border-rekabetli-border bg-rekabetli-surface/80 p-6 shadow-[0_12px_30px_rgba(2,8,18,0.4)] backdrop-blur-sm sm:p-8">
        <div
          role="button"
          tabIndex={0}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !isBusy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
            dragOver
              ? "border-rekabetli-primary bg-rekabetli-primary/10"
              : "border-rekabetli-border bg-rekabetli-bg-soft/60 hover:border-rekabetli-primary/50"
          } ${isBusy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
        >
          <span className="text-3xl" aria-hidden>
            📄
          </span>
          <p className="mt-3 text-sm font-medium text-rekabetli-text">
            PDF sürükle-bırak veya tıkla
          </p>
          <p className="mt-1 text-xs text-rekabetli-muted">
            Yalnızca .pdf · Maks. 50 MB · Kitap, sunum veya çıkmış soru
          </p>
          {file && (
            <p className="mt-4 rounded-lg bg-rekabetli-surface px-3 py-2 text-xs text-rekabetli-primary">
              {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            disabled={isBusy}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {isBusy && (
          <div className="space-y-4 rounded-xl border border-rekabetli-border bg-rekabetli-bg-soft/80 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-rekabetli-text">{statusLabel}</span>
              <span className="tabular-nums text-rekabetli-primary">%{progress}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-rekabetli-surface-strong">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rekabetli-primary to-rekabetli-action transition-all duration-500 ease-out"
                style={{ width: `${Math.min(progress, 100)}%` }}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
            <ul className="space-y-2 text-xs">
              {STEPS.map((step, index) => {
                const done = stepIndex > index || activeStep === "done";
                const current = step.id === activeStep;
                return (
                  <li
                    key={step.id}
                    className={`flex items-center gap-2 ${
                      done
                        ? "text-emerald-400"
                        : current
                          ? "text-rekabetli-primary"
                          : "text-rekabetli-muted/60"
                    }`}
                  >
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        done
                          ? "bg-emerald-500/20"
                          : current
                            ? "bg-rekabetli-primary/20 animate-pulse"
                            : "bg-rekabetli-surface-strong"
                      }`}
                    >
                      {done ? "✓" : index + 1}
                    </span>
                    {step.label}
                  </li>
                );
              })}
            </ul>
            {metadata && (
              <p className="text-xs text-rekabetli-muted">
                Tespit: <strong className="text-rekabetli-text">{metadata.title}</strong>
                {" · "}
                {metadata.author} · {metadata.type} · {metadata.category}
              </p>
            )}
            {chunkTotal > 0 && activeStep === "embed" && (
              <p className="text-xs text-rekabetli-muted">
                {chunkTotal} parça · parti {embedBatch}/{embedBatchTotal}
              </p>
            )}
            <button
              type="button"
              onClick={handleCancel}
              className="text-xs text-rekabetli-muted underline hover:text-rekabetli-text"
            >
              İptal et
            </button>
          </div>
        )}

        {phase === "success" && (
          <div
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-300"
            role="status"
          >
            <p className="font-semibold">{statusLabel}</p>
            <p className="mt-1">{message}</p>
          </div>
        )}

        {phase === "error" && message && (
          <div
            className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
            role="alert"
          >
            {message}
          </div>
        )}

        {phase === "idle" && !message && (
          <p className="text-center text-xs text-rekabetli-muted/80">
            Dosya seçildiğinde işlem otomatik başlar.
          </p>
        )}
      </div>
    </div>
  );
}
