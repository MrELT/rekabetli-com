"use client";

import { useCallback, useState } from "react";
import { notalFetch } from "@/lib/notal-visitor-id";

interface UnifiedIngestResult {
  fileName: string;
  processedPageCount: number;
  rasterEngine: string;
  rawChunkCount: number;
  storedChunkCount: number;
  skippedChunkCount: number;
  detectedFigureCount: number;
  storedFigureCount: number;
  skippedFigureCount: number;
  chunkFigureLinks: number;
  errors: string[];
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

export default function NotalAdminTextIngest() {
  const [file, setFile] = useState<File | null>(null);
  const [subject, setSubject] = useState("");
  const [curriculum, setCurriculum] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UnifiedIngestResult | null>(null);

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
      if (subject.trim()) formData.append("subject", subject.trim());
      if (curriculum.trim()) formData.append("curriculum", curriculum.trim());

      const response = await notalFetch("/api/notal-admin/ingest-text", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as UnifiedIngestResult & {
        error?: string;
        success?: boolean;
      };

      if (!response.ok) {
        setError(data.error ?? "Kitap ingest başarısız.");
        return;
      }

      setResult({
        fileName: data.fileName,
        processedPageCount: data.processedPageCount ?? 0,
        rasterEngine: data.rasterEngine ?? "unknown",
        rawChunkCount: data.rawChunkCount ?? 0,
        storedChunkCount: data.storedChunkCount ?? 0,
        skippedChunkCount: data.skippedChunkCount ?? 0,
        detectedFigureCount: data.detectedFigureCount ?? 0,
        storedFigureCount: data.storedFigureCount ?? 0,
        skippedFigureCount: data.skippedFigureCount ?? 0,
        chunkFigureLinks: data.chunkFigureLinks ?? 0,
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
      <h2 className="text-xl font-semibold text-rekabetli-text">
        YKS Kitap Yükleme (Faz A + B)
      </h2>
      <p className="mt-2 text-sm text-rekabetli-muted">
        Tek yüklemede PDF işlenir: metin parçaları{" "}
        <code className="text-rekabetli-text">yks_chunks</code> tablosuna,
        sayfa renderından kırpılan figürler{" "}
        <code className="text-rekabetli-text">yks_figures</code> + Storage
        bucket&apos;a kaydedilir ve chunk&apos;larla eşleştirilir.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-rekabetli-muted">Ders (isteğe bağlı)</span>
          <select
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={isUploading}
            className="mt-1 w-full rounded-lg border border-rekabetli-border bg-rekabetli-bg-soft px-3 py-2 text-sm text-rekabetli-text"
          >
            {SUBJECT_OPTIONS.map((option) => (
              <option key={option || "auto"} value={option}>
                {option || "Otomatik algıla"}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-rekabetli-muted">Müfredat (isteğe bağlı)</span>
          <select
            value={curriculum}
            onChange={(event) => setCurriculum(event.target.value)}
            disabled={isUploading}
            className="mt-1 w-full rounded-lg border border-rekabetli-border bg-rekabetli-bg-soft px-3 py-2 text-sm text-rekabetli-text"
          >
            <option value="">Otomatik algıla</option>
            <option value="TYT">TYT</option>
            <option value="AYT">AYT</option>
            <option value="genel">Genel</option>
          </select>
        </label>
      </div>

      <div className="mt-4 rounded-lg border border-dashed border-rekabetli-border bg-rekabetli-bg-soft/50 p-6 text-center">
        <input
          id="notal-admin-text-pdf"
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
          ? "Kitap işleniyor (metin + figür)…"
          : "PDF yükle ve arşive ekle"}
      </button>

      {result ? (
        <div className="mt-6 rounded-lg border border-rekabetli-border bg-rekabetli-bg-soft/40 p-4 text-sm">
          <p className="font-medium text-rekabetli-text">{result.fileName}</p>
          <ul className="mt-2 space-y-1 text-rekabetli-muted">
            <li>İşlenen sayfa: {result.processedPageCount}</li>
            <li>Render motoru: {result.rasterEngine}</li>
            <li>Ham chunk: {result.rawChunkCount}</li>
            <li>Kaydedilen chunk: {result.storedChunkCount}</li>
            <li>Tespit edilen figür/soru: {result.detectedFigureCount}</li>
            <li>Kaydedilen figür: {result.storedFigureCount}</li>
            <li>Chunk–figür bağlantısı: {result.chunkFigureLinks}</li>
            <li>Atlanan/hatalı: {result.skippedChunkCount + result.skippedFigureCount}</li>
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
