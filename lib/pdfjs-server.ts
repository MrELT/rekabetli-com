import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PdfJsLike = {
  version?: string;
  GlobalWorkerOptions: { workerSrc: string };
};

const PDFJS_WORKER_RELATIVE = path.join(
  "legacy",
  "build",
  "pdf.worker.mjs",
);

/**
 * pdf-parse ve pdfjs-dist aynı worker sürümünü kullanmalı.
 * Next.js build'de require.resolve(ESM) kullanılmaz; dosya yolu çalışma zamanında kurulur.
 */
export function configurePdfJsWorker(pdfjs: PdfJsLike): void {
  const version = pdfjs.version ?? "5.4.296";
  const localWorker = path.join(process.cwd(), "node_modules", "pdfjs-dist", PDFJS_WORKER_RELATIVE);

  if (fs.existsSync(localWorker)) {
    const workerSource = fs.readFileSync(localWorker, "utf8").slice(0, 400);
    const workerVersionMatch = workerSource.match(/pdfjsVersion\s*=\s*([\d.]+)/);
    const workerVersion = workerVersionMatch?.[1];

    if (workerVersion && workerVersion !== version) {
      console.warn(
        `[pdfjs] Worker/API sürüm uyumsuzluğu önlendi: API=${version}, worker dosyası=${workerVersion}. CDN worker kullanılıyor.`,
      );
      pdfjs.GlobalWorkerOptions.workerSrc =
        `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/legacy/build/pdf.worker.min.mjs`;
      return;
    }

    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(localWorker).href;
    return;
  }

  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/legacy/build/pdf.worker.min.mjs`;
}
