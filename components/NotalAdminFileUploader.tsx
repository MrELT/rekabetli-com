"use client";

import { useCallback, useState } from "react";
import { notalFetch } from "@/lib/notal-visitor-id";

interface UploadResult {
  fileName: string;
  textLength: number;
  processedPageCount: number;
  discardedPageCount: number;
  extractedImageCount: number;
  storedImageCount: number;
  skippedImageCount: number;
  errors: string[];
}

export default function NotalAdminFileUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const onFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const selected = event.target.files?.[0] ?? null;
      setFile(selected);
      setError(null);
      setResult(null);
    },
    [],
  );

  async function handleUpload() {
    if (!file || isUploading) return;

    setIsUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await notalFetch("/api/notal-admin/upload", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as UploadResult & {
        error?: string;
        success?: boolean;
      };

      if (!response.ok) {
        setError(data.error ?? "PDF yüklenemedi.");
        return;
      }

      setResult({
        fileName: data.fileName,
        textLength: data.textLength,
        processedPageCount: data.processedPageCount ?? 0,
        discardedPageCount: data.discardedPageCount ?? 0,
        extractedImageCount: data.extractedImageCount,
        storedImageCount: data.storedImageCount,
        skippedImageCount: data.skippedImageCount,
        errors: data.errors ?? [],
      });
      setFile(null);
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-rekabetli-border bg-rekabetli-surface/80 p-6">
      <h1 className="text-xl font-semibold text-rekabetli-text">
        MEB Kitap PDF Yükleme
      </h1>
      <p className="mt-2 text-sm text-rekabetli-muted">
        PDF sayfaları OpenAI Vision ile analiz edilir; akademik metin, soru ve
        görseller <code className="text-rekabetli-text">notes_images</code>{" "}
        arşivine kaydedilir. Illustrator ajanı multi-modal RAG ile eşleştirir.
      </p>

      <div className="mt-6 rounded-lg border border-dashed border-rekabetli-border bg-rekabetli-bg-soft/50 p-6 text-center">
        <input
          id="notal-admin-pdf"
          type="file"
          accept="application/pdf,.pdf"
          onChange={onFileChange}
          disabled={isUploading}
          className="mx-auto block w-full max-w-md text-sm text-rekabetli-muted file:mr-4 file:rounded-lg file:border-0 file:bg-rekabetli-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-rekabetli-primary-strong"
        />
        {file ? (
          <p className="mt-3 text-xs text-rekabetli-muted">
            Seçilen: {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
          </p>
        ) : null}
      </div>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      <button
        type="button"
        onClick={() => void handleUpload()}
        disabled={!file || isUploading}
        className="mt-4 w-full rounded-xl bg-rekabetli-action px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isUploading
          ? "PDF işleniyor (akademik içerik analizi)…"
          : "PDF yükle ve arşive ekle"}
      </button>

      {result ? (
        <div className="mt-6 rounded-lg border border-rekabetli-border bg-rekabetli-bg-soft/40 p-4 text-sm">
          <p className="font-medium text-rekabetli-text">{result.fileName}</p>
          <ul className="mt-2 space-y-1 text-rekabetli-muted">
            <li>İşlenen sayfa: {result.processedPageCount}</li>
            <li>Atılan sayfa (akademik değil): {result.discardedPageCount}</li>
            <li>Metin katmanı uzunluğu: {result.textLength.toLocaleString("tr-TR")}</li>
            <li>Kaydedilen kayıt: {result.storedImageCount}</li>
            <li>Atlanan/hatalı: {result.skippedImageCount}</li>
          </ul>
          {result.errors.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-amber-300">
                Uyarılar ({result.errors.length})
              </summary>
              <ul className="mt-2 max-h-40 overflow-y-auto text-xs text-rekabetli-muted">
                {result.errors.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
