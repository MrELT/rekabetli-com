import sharp from "sharp";

import { YKS_FIGURE_MAX_WHITE_RATIO, YKS_FIGURE_MIN_DIMENSION } from "@/lib/yks-figures/constants";
import type { NormalizedBbox } from "@/lib/yks-figures/types";

export interface CroppedFigureImage {
  buffer: Buffer;
  width: number;
  height: number;
}

export async function cropFigureFromPage(
  pagePng: Buffer,
  pageWidth: number,
  pageHeight: number,
  bbox: NormalizedBbox,
): Promise<CroppedFigureImage | null> {
  const [xmin, ymin, xmax, ymax] = bbox;

  const left = Math.max(0, Math.floor(xmin * pageWidth));
  const top = Math.max(0, Math.floor(ymin * pageHeight));
  const width = Math.min(pageWidth - left, Math.ceil((xmax - xmin) * pageWidth));
  const height = Math.min(pageHeight - top, Math.ceil((ymax - ymin) * pageHeight));

  if (width < YKS_FIGURE_MIN_DIMENSION || height < YKS_FIGURE_MIN_DIMENSION) {
    return null;
  }

  const buffer = await sharp(pagePng)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();

  const meta = await sharp(buffer).metadata();
  return {
    buffer,
    width: meta.width ?? width,
    height: meta.height ?? height,
  };
}

export async function shouldKeepFigureCrop(
  pngBuffer: Buffer,
): Promise<{ keep: boolean; reason?: string }> {
  const meta = await sharp(pngBuffer).metadata();
  if (!meta.width || !meta.height) {
    return { keep: false, reason: "boyut okunamadı" };
  }

  if (
    meta.width < YKS_FIGURE_MIN_DIMENSION ||
    meta.height < YKS_FIGURE_MIN_DIMENSION
  ) {
    return { keep: false, reason: "çok küçük" };
  }

  const { data, info } = await sharp(pngBuffer)
    .resize(64, 64, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = info.width * info.height;
  if (!pixels) return { keep: false, reason: "piksel yok" };

  let nearWhite = 0;
  for (let i = 0; i < data.length; i += 3) {
    if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
      nearWhite += 1;
    }
  }

  if (nearWhite / pixels > YKS_FIGURE_MAX_WHITE_RATIO) {
    return { keep: false, reason: "boşluk ağırlıklı" };
  }

  return { keep: true };
}
