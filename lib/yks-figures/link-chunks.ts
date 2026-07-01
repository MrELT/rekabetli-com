import { cosineSimilarity } from "@/lib/yks-figures/embed";
import { YKS_FIGURES_LINK_THRESHOLD } from "@/lib/yks-figures/constants";
import type { StoredChunkRef } from "@/lib/yks-figures/types";

export interface ChunkFigureLink {
  chunkId: string;
  linkScore: number;
}

export function buildChunkFigureLinks(
  figureEmbedding: number[],
  chunksOnPage: StoredChunkRef[],
): ChunkFigureLink[] {
  if (!chunksOnPage.length) return [];

  const scored = chunksOnPage
    .map((chunk) => ({
      chunkId: chunk.id,
      linkScore: cosineSimilarity(figureEmbedding, chunk.embedding),
    }))
    .filter((item) => item.linkScore >= YKS_FIGURES_LINK_THRESHOLD)
    .sort((a, b) => b.linkScore - a.linkScore);

  if (scored.length) return scored;

  const best = chunksOnPage
    .map((chunk) => ({
      chunkId: chunk.id,
      linkScore: cosineSimilarity(figureEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.linkScore - a.linkScore)[0];

  return best ? [best] : [];
}
