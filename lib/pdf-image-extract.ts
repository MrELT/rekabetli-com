import sharp from "sharp";
import { configurePdfJsWorker } from "@/lib/pdfjs-server";
import {
  NOTES_IMAGES_MIN_DIMENSION,
} from "@/lib/notes-images/constants";
import type { PdfExtractedImage } from "@/lib/notes-images/types";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsModule: PdfJsModule | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsModule) {
    pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs");
    configurePdfJsWorker(pdfjsModule);
  }

  return pdfjsModule;
}
interface RawPdfImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
  kind?: number;
}

function isLargeEnough(width: number, height: number): boolean {
  return (
    width >= NOTES_IMAGES_MIN_DIMENSION &&
    height >= NOTES_IMAGES_MIN_DIMENSION
  );
}

async function rawImageToPngBuffer(image: RawPdfImage): Promise<Buffer | null> {
  if (!isLargeEnough(image.width, image.height)) {
    return null;
  }

  try {
    return await sharp(Buffer.from(image.data), {
      raw: {
        width: image.width,
        height: image.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  } catch {
    try {
      return await sharp(Buffer.from(image.data)).png().toBuffer();
    } catch {
      return null;
    }
  }
}

async function collectImageFromObject(
  pageNumber: number,
  imageIndex: number,
  image: RawPdfImage,
  results: PdfExtractedImage[],
): Promise<void> {
  const pngBuffer = await rawImageToPngBuffer(image);
  if (!pngBuffer) return;

  results.push({
    pageNumber,
    imageIndex,
    width: image.width,
    height: image.height,
    mimeType: "image/png",
    buffer: pngBuffer,
  });
}

/** pdfjs-dist ile PDF içindeki gömülü görselleri ayıklar */
export async function extractImagesFromPdfBuffer(
  buffer: Buffer,
): Promise<PdfExtractedImage[]> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const results: PdfExtractedImage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const ops = await page.getOperatorList();
      let imageIndex = 0;

      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const isImageOp =
          fn === pdfjs.OPS.paintImageXObject ||
          fn === pdfjs.OPS.paintInlineImageXObject;

        if (!isImageOp) continue;

        const args = ops.argsArray[i];
        const imageName = args?.[0];
        if (typeof imageName !== "string") continue;

        try {
          const image = (await page.objs.get(imageName)) as RawPdfImage | null;
          if (!image?.data || !image.width || !image.height) continue;

          await collectImageFromObject(
            pageNumber,
            imageIndex,
            image,
            results,
          );
          imageIndex += 1;
        } catch {
          /* tek görsel hatası tüm PDF'i durdurmasın */
        }
      }
    }
  } finally {
    await doc.destroy();
  }

  return results;
}
