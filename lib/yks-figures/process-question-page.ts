import sharp from "sharp";
import type OpenAI from "openai";

import { cropFigureFromPage, shouldKeepFigureCrop } from "@/lib/yks-figures/crop";
import { detectQuestionsOnPage } from "@/lib/yks-figures/detect-questions";
import {
  reviseQuestionCropsOnPage,
  shouldReviseQuestionPage,
} from "@/lib/yks-figures/revise-question-crops-page";
import type { NormalizedBbox } from "@/lib/yks-figures/types";

export interface ProcessedQuestionCrop {
  textPreview: string;
  bbox: NormalizedBbox;
  buffer: Buffer;
  width: number;
  height: number;
  cropRevision: {
    wasRevised: boolean;
    complete: boolean;
    issues: string[];
  } | null;
}

async function getPngDimensions(buffer: Buffer): Promise<{
  width: number;
  height: number;
}> {
  const meta = await sharp(buffer).metadata();
  return {
    width: meta.width ?? 1200,
    height: meta.height ?? 1600,
  };
}

/**
 * Tek sayfa: soru tespiti → kırpım → (gerekirse) toplu revizyon.
 * Soru başına ayrı vision çağrısı yapmaz; sayfa başına en fazla 2 çağrı.
 */
export async function processQuestionPage(
  openai: OpenAI,
  pagePng: Buffer,
  options: { fileName: string; pageNumber: number },
): Promise<{ crops: ProcessedQuestionCrop[]; errors: string[] }> {
  const errors: string[] = [];

  let questions;
  try {
    questions = await detectQuestionsOnPage(openai, pagePng, options);
  } catch (error) {
    errors.push(
      error instanceof Error
        ? `s.${options.pageNumber} tespit: ${error.message}`
        : `s.${options.pageNumber} tespit edilemedi`,
    );
    return { crops: [], errors };
  }

  if (!questions.length) {
    return { crops: [], errors };
  }

  const { width: pageWidth, height: pageHeight } = await getPngDimensions(pagePng);

  let revisions = questions.map((question, index) => ({
    index,
    bbox: question.bbox,
    needsRevision: false,
    complete: question.complete ?? false,
    issues: [] as string[],
    wasRevised: false,
  }));

  if (shouldReviseQuestionPage(questions)) {
    try {
      revisions = await reviseQuestionCropsOnPage(openai, {
        pagePng,
        questions,
        fileName: options.fileName,
        pageNumber: options.pageNumber,
      });
    } catch (error) {
      console.warn(
        `[process-question-page] s.${options.pageNumber} toplu revizyon atlandı:`,
        error,
      );
    }
  }

  const crops: ProcessedQuestionCrop[] = [];

  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    const revision = revisions[index];
    const bbox = revision?.bbox ?? question.bbox;

    const cropped = await cropFigureFromPage(
      pagePng,
      pageWidth,
      pageHeight,
      bbox,
    );
    if (!cropped) continue;

    const quality = await shouldKeepFigureCrop(cropped.buffer);
    if (!quality.keep) continue;

    crops.push({
      textPreview: question.textPreview,
      bbox,
      buffer: cropped.buffer,
      width: cropped.width,
      height: cropped.height,
      cropRevision: revision
        ? {
            wasRevised: revision.wasRevised,
            complete: revision.complete,
            issues: revision.issues,
          }
        : null,
    });
  }

  return { crops, errors };
}
