import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createCanvas } from "@napi-rs/canvas";

import { YKS_PAGE_RENDER_DPI } from "@/lib/yks-figures/constants";
import { configurePdfJsWorker } from "@/lib/pdfjs-server";

const execFileAsync = promisify(execFile);

export type PdfRasterEngine = "poppler" | "pdfjs";

export interface RasterizedPdfPage {
  pageNumber: number;
  width: number;
  height: number;
  pngBuffer: Buffer;
}

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsModule: PdfJsModule | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsModule) {
    pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs");
    configurePdfJsWorker(pdfjsModule);
  }
  return pdfjsModule;
}

function resolvePdftoppmPath(): string {
  const custom =
    process.env.PDFTOPPM_PATH?.trim() ||
    process.env.POPPLER_BIN?.trim() ||
    process.env.POPPLER_PATH?.trim();

  if (!custom) return "pdftoppm";

  if (/pdftoppm(\.exe)?$/i.test(custom)) return custom;
  return path.join(custom, process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm");
}

async function popplerAvailable(): Promise<boolean> {
  try {
    const bin = resolvePdftoppmPath();
    await execFileAsync(bin, ["-v"]);
    return true;
  } catch {
    return false;
  }
}

async function listPopplerPngFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir);
  return entries
    .filter((name) => /^.+\-\d+\.png$/i.test(name) || /^page-\d+\.png$/i.test(name))
    .sort((a, b) => {
      const numA = Number(a.match(/(\d+)\.png$/i)?.[1] ?? 0);
      const numB = Number(b.match(/(\d+)\.png$/i)?.[1] ?? 0);
      return numA - numB;
    });
}

async function rasterizeWithPoppler(
  buffer: Buffer,
  maxPages: number,
  dpi: number,
): Promise<RasterizedPdfPage[]> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yks-pdf-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  const prefix = path.join(tmpDir, "page");

  await fs.writeFile(pdfPath, buffer);

  try {
    const bin = resolvePdftoppmPath();
    await execFileAsync(bin, [
      "-png",
      "-r",
      String(dpi),
      "-f",
      "1",
      "-l",
      String(maxPages),
      pdfPath,
      prefix,
    ]);

    const pngFiles = await listPopplerPngFiles(tmpDir);
    const results: RasterizedPdfPage[] = [];

    for (let index = 0; index < pngFiles.length; index++) {
      const pngBuffer = await fs.readFile(path.join(tmpDir, pngFiles[index]));
      const sharp = (await import("sharp")).default;
      const meta = await sharp(pngBuffer).metadata();

      results.push({
        pageNumber: index + 1,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        pngBuffer,
      });
    }

    return results;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function rasterizeWithPdfJs(
  buffer: Buffer,
  maxPages: number,
  dpi: number,
): Promise<RasterizedPdfPage[]> {
  const pdfjs = await loadPdfJs();
  const scale = dpi / 72;

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  const pageLimit = Math.min(doc.numPages, maxPages);
  const results: RasterizedPdfPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const context = canvas.getContext("2d");

      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        canvas: canvas as unknown as HTMLCanvasElement,
      }).promise;

      const pngBuffer = canvas.toBuffer("image/png");
      results.push({
        pageNumber,
        width: Math.ceil(viewport.width),
        height: Math.ceil(viewport.height),
        pngBuffer,
      });
    }
  } finally {
    await doc.destroy();
  }

  return results;
}

/** PDF sayfalarını PNG raster'a çevirir (Poppler öncelikli, pdf.js yedek). */
export async function rasterizePdfPages(
  buffer: Buffer,
  options?: { maxPages?: number; dpi?: number },
): Promise<{ pages: RasterizedPdfPage[]; engine: PdfRasterEngine }> {
  const maxPages = options?.maxPages ?? 80;
  const dpi = options?.dpi ?? YKS_PAGE_RENDER_DPI;

  if (await popplerAvailable()) {
    try {
      const pages = await rasterizeWithPoppler(buffer, maxPages, dpi);
      if (pages.length) return { pages, engine: "poppler" };
    } catch (error) {
      console.warn("[pdf-raster] Poppler başarısız, pdf.js deneniyor:", error);
    }
  }

  const pages = await rasterizeWithPdfJs(buffer, maxPages, dpi);
  return { pages, engine: "pdfjs" };
}
