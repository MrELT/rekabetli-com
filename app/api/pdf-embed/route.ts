import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  EMBEDDING_MODEL,
  EMBED_BATCH_SIZE,
  type SourceType,
} from "@/lib/pdf-ingest-shared";
import { mapMetadataTypeToSourceType } from "@/lib/pdf-metadata-map";
import { recordPdfIngestProgress } from "@/lib/notal-pdf-ingest-server";
import { enforceRateLimit } from "@/lib/notal-rate-limit";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import {
  identityRateLimitKey,
  resolveAuthenticatedIdentity,
} from "@/lib/notal-request-identity";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface EmbedRequestBody {
  chunks?: unknown;
  title?: string;
  author?: string;
  category?: string;
  type?: string;
  pdf_url?: string;
  source_type?: string;
  source_name?: string;
  file_name?: string;
  chunk_offset?: number;
  total_chunks?: number;
  ingest_key?: string;
}

interface ChunkInsertRow {
  source_type: SourceType;
  source_name: string;
  title: string | null;
  author: string | null;
  subject: string | null;
  content: string;
  embedding: number[];
  pdf_url: string | null;
  metadata: Record<string, unknown>;
  is_published: boolean;
}

async function embedChunks(
  openai: OpenAI,
  chunks: string[],
): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: chunks,
  });

  const sorted = [...response.data].sort((a, b) => a.index - b.index);
  return sorted.map((item) => {
    if (!item.embedding?.length) {
      throw new Error("Embedding yanıtı eksik.");
    }
    return item.embedding;
  });
}

export async function POST(request: NextRequest) {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) {
    return NextResponse.json(
      { error: "OpenAI yapılandırması eksik." },
      { status: 500 },
    );
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json(
      {
        error:
          "PDF arşivleme için SUPABASE_SERVICE_ROLE_KEY ortam değişkeni gerekli.",
      },
      { status: 500 },
    );
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase yapılandırması eksik." },
      { status: 500 },
    );
  }

  const identity = await resolveAuthenticatedIdentity(request);
  if (!identity) {
    return notalAuthRequiredResponse();
  }

  const limited = enforceRateLimit(
    request,
    "pdf-embed",
    identityRateLimitKey(identity),
    40,
    60 * 60 * 1000,
  );
  if (limited) return limited;

  let body: EmbedRequestBody;
  try {
    body = (await request.json()) as EmbedRequestBody;
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON." }, { status: 400 });
  }

  const title = String(body.title ?? "").trim();
  const author = String(body.author ?? body.source_name ?? "").trim();
  const category = String(body.category ?? "").trim();
  const typeLabel = String(body.type ?? "").trim();
  const pdfUrl = String(body.pdf_url ?? "").trim();
  const fileName = String(body.file_name ?? "").trim();
  const chunkOffset = Number(body.chunk_offset ?? 0);
  const totalChunks = Number(body.total_chunks ?? 0);
  const ingestKey = String(body.ingest_key ?? "").trim();

  if (!ingestKey) {
    return NextResponse.json(
      { error: "Yükleme oturumu (ingest_key) gerekli." },
      { status: 400 },
    );
  }

  if (!Number.isFinite(totalChunks) || totalChunks < 1) {
    return NextResponse.json(
      { error: "total_chunks gerekli." },
      { status: 400 },
    );
  }

  const sourceType = mapMetadataTypeToSourceType(typeLabel || "Kitap");

  if (!author || author.length > 200) {
    return NextResponse.json(
      { error: "Yazar/kurum (author) gerekli (en fazla 200 karakter)." },
      { status: 400 },
    );
  }

  if (title.length > 200) {
    return NextResponse.json(
      { error: "Başlık en fazla 200 karakter olabilir." },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.chunks) || body.chunks.length === 0) {
    return NextResponse.json({ error: "chunks dizisi gerekli." }, { status: 400 });
  }

  if (body.chunks.length > EMBED_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Bir istekte en fazla ${EMBED_BATCH_SIZE} parça gönderilebilir.` },
      { status: 400 },
    );
  }

  const chunks = body.chunks
    .filter((c): c is string => typeof c === "string" && c.trim().length >= 50)
    .map((c) => c.trim());

  if (!chunks.length) {
    return NextResponse.json(
      { error: "Geçerli chunk bulunamadı." },
      { status: 400 },
    );
  }

  try {
    const openai = new OpenAI({ apiKey: openaiKey });
    const embeddings = await embedChunks(openai, chunks);

    const ingestId = fileName || title || author;
    const rows: ChunkInsertRow[] = chunks.map((content, index) => ({
      source_type: sourceType,
      source_name: author,
      title: title || null,
      author,
      subject: category || null,
      content,
      embedding: embeddings[index],
      pdf_url: pdfUrl || null,
      metadata: {
        file_name: fileName || null,
        ingest_id: ingestId,
        chunk_index: chunkOffset + index + 1,
        total_chunks: totalChunks || null,
        category: category || null,
        document_type: typeLabel || null,
        pdf_url: pdfUrl || null,
        author,
        ingest_source: "pdf-ingest-v2",
        ingested_at: new Date().toISOString(),
      },
      is_published: true,
    }));

    const { error } = await supabase.from("academic_library_chunks").insert(rows);

    if (error) {
      console.error("Supabase insert hatası:", error);
      throw error;
    }

    const { complete } = await recordPdfIngestProgress(supabase, identity, {
      ingestKey,
      totalChunks,
      batchSize: rows.length,
      pdfUrl,
      title,
    });

    return NextResponse.json({
      success: true,
      inserted: rows.length,
      chunkOffset,
      ingestComplete: complete,
    });
  } catch (error) {
    console.error("PDF embed hatası:", error);
    return NextResponse.json(
      { error: "Vektörleme veya kayıt sırasında hata oluştu." },
      { status: 500 },
    );
  }
}
