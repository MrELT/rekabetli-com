"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import NotalNoteFeedback from "@/components/NotalNoteFeedback";
import NotalNoteViewer from "@/components/NotalNoteViewer";
import {
  DIFFICULTY_LABELS,
  type NotalDifficulty,
} from "@/lib/notal-difficulty";
import type { SavedNotalNote } from "@/lib/notal-subjects";
import { ensureNotalVisitorCookie, notalFetch } from "@/lib/notal-visitor-id";

function depthLabel(depth: string): string {
  if (depth === "kolay" || depth === "orta" || depth === "zor") {
    return DIFFICULTY_LABELS[depth as NotalDifficulty].label;
  }
  return depth;
}

export default function NotalNoteDetail() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const [note, setNote] = useState<SavedNotalNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        await ensureNotalVisitorCookie();
        const res = await notalFetch(`/api/notal/notes/${id}`);
        const data = (await res.json()) as {
          note?: SavedNotalNote;
          error?: string;
        };
        if (!res.ok) {
          setError(data.error ?? "Not yüklenemedi.");
          return;
        }
        setNote(data.note ?? null);
      } catch {
        setError("Bağlantı hatası.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8">
        <Link
          href="/notal/notlar"
          className="text-sm text-rekabetli-primary hover:underline"
        >
          ← Tüm notlar
        </Link>
      </div>

      {loading && (
        <p className="text-center text-sm text-rekabetli-muted">
          Not yükleniyor…
        </p>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && note && (
        <>
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-rekabetli-text sm:text-3xl">
              {note.title}
            </h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-rekabetli-primary/15 px-3 py-1 text-xs font-medium text-rekabetli-primary">
                {note.subject}
              </span>
              <span className="rounded-full bg-rekabetli-action/15 px-3 py-1 text-xs font-medium text-rekabetli-action">
                {depthLabel(note.depth)}
              </span>
            </div>
          </header>
          <div className="rounded-2xl border border-rekabetli-border bg-rekabetli-surface/60 p-6">
            <NotalNoteViewer content={note.content} />
            <NotalNoteFeedback noteId={note.id} />
          </div>
        </>
      )}
    </div>
  );
}
