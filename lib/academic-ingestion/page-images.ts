import sharp from "sharp";
import type { PdfExtractedImage } from "@/lib/notes-images/types";

/** Metin-only kayıtlar için minimal placeholder PNG */
export async function createTextPlaceholderImage(): Promise<PdfExtractedImage> {
  const width = 480;
  const height = 320;
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 248, g: 249, b: 250 },
    },
  })
    .png()
    .toBuffer();

  return {
    pageNumber: 0,
    imageIndex: 0,
    width,
    height,
    mimeType: "image/png",
    buffer,
  };
}

export function groupExtractedImagesByPage(
  images: PdfExtractedImage[],
): Map<number, PdfExtractedImage[]> {
  const map = new Map<number, PdfExtractedImage[]>();

  for (const image of images) {
    const list = map.get(image.pageNumber) ?? [];
    list.push(image);
    map.set(image.pageNumber, list);
  }

  return map;
}
