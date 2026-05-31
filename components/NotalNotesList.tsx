"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import RekabetliLogo from "@/components/RekabetliLogo";
import {
  DIFFICULTY_LABELS,
  NOTAL_DIFFICULTIES,
  type NotalDifficulty,
} from "@/lib/notal-difficulty";
import { NOTAL_SUBJECTS, type NotalNoteListItem } from "@/lib/notal-subjects";
import { ensureNotalVisitorCookie, notalFetch } from "@/lib/notal-visitor-id";

type SubjectFilter = "tumu" | (typeof NOTAL_SUBJECTS)[number];
type DepthFilter = "tumu" | NotalDifficulty;

function depthLabel(depth: string): string {
  if (depth === "kolay" || depth === "orta" || depth === "zor") {
    return DIFFICULTY_LABELS[depth as NotalDifficulty].label;
  }
  return depth;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-rekabetli-primary bg-rekabetli-primary/15 text-rekabetli-primary"
          : "border-rekabetli-border bg-rekabetli-bg-soft/60 text-rekabetli-muted hover:border-rekabetli-primary/40 hover:text-rekabetli-text"
      }`}
    >
      {label}
    </button>
  );
}

export default function NotalNotesList() {
  const [notes, setNotes] = useState<NotalNoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<SubjectFilter>("tumu");
  const [depthFilter, setDepthFilter] = useState<DepthFilter>("tumu");

  useEffect(() => {
    void (async () => {
      try {
        await ensureNotalVisitorCookie();
        const res = await notalFetch("/api/notal/notes");
        const data = (await res.json()) as {
          notes?: NotalNoteListItem[];
          error?: string;
        };
        if (!res.ok) {
          setError(data.error ?? "Notlar yüklenemedi.");
          return;
        }
        setNotes(data.notes ?? []);
      } catch {
        setError("Bağlantı hatası.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredNotes = useMemo(() => {
    return notes.filter((note) => {
      const subjectOk =
        subjectFilter === "tumu" || note.subject === subjectFilter;
      const depthOk = depthFilter === "tumu" || note.depth === depthFilter;
      return subjectOk && depthOk;
    });
  }, [notes, subjectFilter, depthFilter]);

  const hasNotes = notes.length > 0;
  const hasFilteredNotes = filteredNotes.length > 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-8 text-center">
        <div className="mb-3 flex justify-center">
          <RekabetliLogo href="/" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-rekabetli-text sm:text-4xl">
          Notlarım
        </h1>
        <p className="mt-3 text-sm text-rekabetli-muted sm:text-base">
          Topluluk tarafından oluşturulan tüm notlar alan ve derinliğe göre
          listelenir.
        </p>
      </header>

      {hasNotes && (
        <div className="mb-6 space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-rekabetli-muted">
              Alan
            </p>
            <div className="flex flex-wrap gap-2">
              <FilterChip
                active={subjectFilter === "tumu"}
                label="Tümü"
                onClick={() => setSubjectFilter("tumu")}
              />
              {NOTAL_SUBJECTS.map((subject) => (
                <FilterChip
                  key={subject}
                  active={subjectFilter === subject}
                  label={subject}
                  onClick={() => setSubjectFilter(subject)}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-rekabetli-muted">
              Derinlik
            </p>
            <div className="flex flex-wrap gap-2">
              <FilterChip
                active={depthFilter === "tumu"}
                label="Tümü"
                onClick={() => setDepthFilter("tumu")}
              />
              {NOTAL_DIFFICULTIES.map((depth) => (
                <FilterChip
                  key={depth}
                  active={depthFilter === depth}
                  label={DIFFICULTY_LABELS[depth].label}
                  onClick={() => setDepthFilter(depth)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <p className="text-center text-sm text-rekabetli-muted">
          Notlar yükleniyor…
        </p>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && !hasNotes && (
        <div className="rounded-xl border border-rekabetli-border bg-rekabetli-surface/60 px-6 py-10 text-center">
          <p className="text-sm text-rekabetli-muted">Henüz kayıtlı not yok.</p>
          <Link
            href="/notal"
            className="mt-4 inline-block rounded-lg bg-rekabetli-primary px-4 py-2 text-sm font-semibold text-white hover:bg-rekabetli-primary-strong"
          >
            İlk notunu oluştur
          </Link>
        </div>
      )}

      {!loading && hasNotes && !hasFilteredNotes && (
        <div className="rounded-xl border border-rekabetli-border bg-rekabetli-surface/60 px-6 py-10 text-center">
          <p className="text-sm text-rekabetli-muted">
            Bu filtreye uygun not bulunamadı.
          </p>
          <button
            type="button"
            className="mt-4 text-sm text-rekabetli-primary hover:underline"
            onClick={() => {
              setSubjectFilter("tumu");
              setDepthFilter("tumu");
            }}
          >
            Filtreleri temizle
          </button>
        </div>
      )}

      {!loading && hasFilteredNotes && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filteredNotes.map((note) => (
            <li key={note.id}>
              <Link
                href={`/notal/notlar/${note.id}`}
                className="group flex h-full flex-col rounded-xl border border-rekabetli-border bg-rekabetli-surface/80 p-4 text-left shadow-sm transition hover:border-rekabetli-primary/50 hover:bg-rekabetli-surface"
              >
                <h2 className="line-clamp-2 text-base font-semibold text-rekabetli-text group-hover:text-rekabetli-primary">
                  {note.title}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full bg-rekabetli-primary/15 px-2.5 py-0.5 text-xs font-medium text-rekabetli-primary">
                    {note.subject}
                  </span>
                  <span className="rounded-full bg-rekabetli-action/15 px-2.5 py-0.5 text-xs font-medium text-rekabetli-action">
                    {depthLabel(note.depth)}
                  </span>
                </div>
                <p className="mt-auto pt-3 text-xs text-rekabetli-muted">
                  {formatDate(note.created_at)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
