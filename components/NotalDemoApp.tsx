"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import NotalNoteViewer from "@/components/NotalNoteViewer";
import type { NotalCreditsState } from "@/lib/notal-credits-shared";
import {
  DIFFICULTY_LABELS,
  NOTAL_DIFFICULTIES,
  type NotalDifficulty,
} from "@/lib/notal-difficulty";
import type { NotalNoteListItem, SavedNotalNote } from "@/lib/notal-subjects";
import {
  NOTAL_MAX_TOPIC_CHARS,
  NOTAL_MAX_TOPIC_WORDS,
  clampNotalTopicInput,
  countNotalTopicWords,
  notalTopicWordLimitError,
} from "@/lib/notal-topic-limits";
import { ensureNotalVisitorCookie, notalFetch } from "@/lib/notal-visitor-id";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: string[];
  meta?: {
    educationLevel?: string;
    hasVisuals?: boolean;
    noteId?: string;
  };
}

function formatNoteDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function NotalDemoApp() {
  const [notes, setNotes] = useState<NotalNoteListItem[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState<string | null>(null);

  const [selectedNote, setSelectedNote] = useState<SavedNotalNote | null>(null);
  const [selectedNoteLoading, setSelectedNoteLoading] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Merhaba! Bir konu yazın (ör. **TYT Trigonometri — birim çember**) — multi-agent NotAl notunuzu üretsin.",
    },
  ]);

  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<NotalDifficulty>("orta");
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [credits, setCredits] = useState<NotalCreditsState | null>(null);

  const refreshNotes = useCallback(async () => {
    setNotesLoading(true);
    setNotesError(null);
    try {
      await ensureNotalVisitorCookie();
      const res = await notalFetch("/api/notal/notes");
      const data = (await res.json()) as {
        notes?: NotalNoteListItem[];
        error?: string;
      };
      if (!res.ok) {
        setNotesError(data.error ?? "Notlar yüklenemedi.");
        return;
      }
      setNotes(data.notes ?? []);
    } catch {
      setNotesError("Notlar yüklenemedi.");
    } finally {
      setNotesLoading(false);
    }
  }, []);

  const refreshCredits = useCallback(async () => {
    try {
      const res = await notalFetch("/api/notal/credits");
      if (res.ok) {
        setCredits((await res.json()) as NotalCreditsState);
      }
    } catch {
      /* opsiyonel */
    }
  }, []);

  useEffect(() => {
    void refreshNotes();
    void refreshCredits();
  }, [refreshNotes, refreshCredits]);

  const loadNoteDetail = useCallback(async (noteId: string) => {
    setSelectedNoteLoading(true);
    setSelectedNote(null);
    try {
      const res = await notalFetch(`/api/notal/notes/${noteId}`);
      const data = (await res.json()) as {
        note?: SavedNotalNote;
        error?: string;
      };
      if (!res.ok || !data.note) {
        setNotesError(data.error ?? "Not detayı yüklenemedi.");
        return;
      }
      setSelectedNote(data.note);
    } catch {
      setNotesError("Not detayı yüklenemedi.");
    } finally {
      setSelectedNoteLoading(false);
    }
  }, []);

  const handleSelectNote = useCallback(
    (noteId: string) => {
      void loadNoteDetail(noteId);
    },
    [loadNoteDetail],
  );

  const handleBackToChat = useCallback(() => {
    setSelectedNote(null);
  }, []);

  const creditLabel = useMemo(() => {
    if (!credits) return "—";
    return `${credits.notesRemaining} hak`;
  }, [credits]);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || isGenerating) return;

    if (countNotalTopicWords(trimmed) > NOTAL_MAX_TOPIC_WORDS) {
      setChatError(notalTopicWordLimitError());
      return;
    }

    setIsGenerating(true);
    setChatError(null);
    setSelectedNote(null);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMessage]);
    setTopic("");

    try {
      const response = await notalFetch("/api/notal", {
        method: "POST",
        body: JSON.stringify({
          topic: trimmed,
          difficulty,
        }),
      });

      const data = (await response.json()) as {
        finalNote?: string;
        steps?: string[];
        noteId?: string;
        educationLevel?: string;
        hasVisuals?: boolean;
        error?: string;
        code?: string;
        credits?: NotalCreditsState;
      };

      if (response.status === 403 && data.code === "no_credits") {
        if (data.credits) setCredits(data.credits);
        setChatError(
          "Not hakkınız kalmadı. SETUP.md dosyasındaki SQL ile test hakkı tanımlayabilirsiniz.",
        );
        return;
      }

      if (!response.ok) {
        setChatError(data.error ?? "Not üretilemedi.");
        return;
      }

      const noteBody =
        data.finalNote ??
        (data.noteId
          ? (
              await notalFetch(`/api/notal/notes/${data.noteId}`).then(async (r) => {
                const detail = (await r.json()) as { note?: SavedNotalNote };
                return detail.note?.content ?? null;
              })
            )
          : null);

      if (!noteBody) {
        setChatError(data.error ?? "Not üretilemedi.");
        return;
      }

      if (data.credits) setCredits(data.credits);
      else void refreshCredits();

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: noteBody,
        steps: data.steps ?? [],
        meta: {
          educationLevel: data.educationLevel,
          hasVisuals: data.hasVisuals,
          noteId: data.noteId,
        },
      };

      setMessages((prev) => [...prev, assistantMessage]);
      void refreshNotes();
    } catch {
      setChatError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-5rem)] max-w-7xl flex-col gap-3 px-3 py-4 sm:px-4 lg:flex-row">
      {/* Sol sidebar */}
      <aside className="flex w-full shrink-0 flex-col rounded-xl border border-rekabetli-border bg-rekabetli-surface/80 lg:w-72">
        <div className="border-b border-rekabetli-border px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-rekabetli-text">
              Kayıtlı Notlar
            </h2>
            <button
              type="button"
              onClick={() => void refreshNotes()}
              className="text-xs text-rekabetli-primary hover:underline"
            >
              Yenile
            </button>
          </div>
          <p className="mt-1 text-xs text-rekabetli-muted">
            Kalan hak: {creditLabel}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {notesLoading ? (
            <p className="px-2 py-4 text-xs text-rekabetli-muted">Yükleniyor…</p>
          ) : notesError ? (
            <p className="px-2 py-4 text-xs text-red-400">{notesError}</p>
          ) : notes.length === 0 ? (
            <p className="px-2 py-4 text-xs text-rekabetli-muted">
              Henüz not yok. Orta alandan ilk notunuzu üretin.
            </p>
          ) : (
            <ul className="space-y-1">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectNote(note.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition ${
                      selectedNote?.id === note.id
                        ? "bg-rekabetli-primary/20 ring-1 ring-rekabetli-primary/40"
                        : "hover:bg-rekabetli-bg-soft/80"
                    }`}
                  >
                    <p className="line-clamp-2 text-sm font-medium text-rekabetli-text">
                      {note.title}
                    </p>
                    <p className="mt-1 text-[11px] text-rekabetli-muted">
                      {note.subject} · {note.depth} ·{" "}
                      {formatNoteDate(note.created_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Ana alan */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-rekabetli-border bg-rekabetli-surface/60">
        {selectedNote || selectedNoteLoading ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-rekabetli-border px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-rekabetli-muted">
                  Not detayı
                </p>
                <h1 className="truncate text-lg font-semibold text-rekabetli-text">
                  {selectedNote?.title ?? "Yükleniyor…"}
                </h1>
              </div>
              <button
                type="button"
                onClick={handleBackToChat}
                className="shrink-0 rounded-lg border border-rekabetli-border px-3 py-1.5 text-xs text-rekabetli-text hover:bg-rekabetli-bg-soft"
              >
                Sohbete dön
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {selectedNoteLoading ? (
                <p className="text-sm text-rekabetli-muted">Not yükleniyor…</p>
              ) : selectedNote ? (
                <>
                  <div className="mb-4 flex flex-wrap gap-2 text-xs text-rekabetli-muted">
                    <span className="rounded-full bg-rekabetli-bg-soft px-2 py-1">
                      {selectedNote.subject}
                    </span>
                    <span className="rounded-full bg-rekabetli-bg-soft px-2 py-1">
                      {selectedNote.depth}
                    </span>
                    <span className="rounded-full bg-rekabetli-bg-soft px-2 py-1">
                      {formatNoteDate(selectedNote.created_at)}
                    </span>
                  </div>
                  <NotalNoteViewer content={selectedNote.content} />
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-rekabetli-border px-4 py-3">
              <h1 className="text-lg font-semibold text-rekabetli-text">
                NotAl Demo Chat
              </h1>
              <p className="text-xs text-rekabetli-muted">
                `mainNotalGraph` — supervisor → içerik üretimi → illustrator →
                polish
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[92%] rounded-2xl px-4 py-3 sm:max-w-[80%] ${
                      message.role === "user"
                        ? "bg-rekabetli-primary text-white"
                        : "border border-rekabetli-border bg-rekabetli-bg-soft/70"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <NotalNoteViewer
                        content={message.content}
                        className="prose-invert"
                      />
                    ) : (
                      <p className="text-sm">{message.content}</p>
                    )}

                    {message.role === "assistant" && message.steps?.length ? (
                      <details className="mt-3 rounded-lg border border-rekabetli-border/60 bg-rekabetli-bg/40 p-2">
                        <summary className="cursor-pointer text-xs font-medium text-rekabetli-muted">
                          Agent adımları ({message.steps.length})
                        </summary>
                        <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] text-rekabetli-muted">
                          {message.steps.map((step, index) => (
                            <li key={`${message.id}-step-${index}`}>{step}</li>
                          ))}
                        </ol>
                        {message.meta ? (
                          <p className="mt-2 text-[11px] text-rekabetli-muted">
                            Seviye: {message.meta.educationLevel ?? "—"}
                            {message.meta.hasVisuals ? " · görseller eklendi" : ""}
                            {message.meta.noteId
                              ? ` · kayıt: ${message.meta.noteId.slice(0, 8)}…`
                              : ""}
                          </p>
                        ) : null}
                      </details>
                    ) : null}
                  </div>
                </div>
              ))}

              {isGenerating ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-rekabetli-border bg-rekabetli-bg-soft/70 px-4 py-3">
                    <p className="text-sm text-rekabetli-muted">
                      LangGraph çalışıyor… (supervisor → classify → retrieve →
                      write → illustrator → polish)
                    </p>
                    <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-rekabetli-border">
                      <div className="h-full w-1/2 animate-pulse rounded-full bg-rekabetli-primary" />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="border-t border-rekabetli-border p-4"
            >
              {chatError ? (
                <p className="mb-2 text-xs text-red-400">{chatError}</p>
              ) : null}

              <div className="mb-3 flex flex-wrap gap-2">
                {NOTAL_DIFFICULTIES.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDifficulty(level)}
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      difficulty === level
                        ? "bg-rekabetli-action text-white"
                        : "border border-rekabetli-border text-rekabetli-muted hover:text-rekabetli-text"
                    }`}
                    title={DIFFICULTY_LABELS[level].hint}
                  >
                    {DIFFICULTY_LABELS[level].label}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={topic}
                  onChange={(event) =>
                    setTopic(clampNotalTopicInput(event.target.value))
                  }
                  placeholder="Örn. Kepler Yasaları"
                  maxLength={NOTAL_MAX_TOPIC_CHARS}
                  disabled={isGenerating}
                  className="min-w-0 flex-1 rounded-xl border border-rekabetli-border bg-rekabetli-bg px-4 py-3 text-sm text-rekabetli-text placeholder:text-rekabetli-muted focus:border-rekabetli-primary focus:outline-none focus:ring-1 focus:ring-rekabetli-primary/40 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={isGenerating || !topic.trim()}
                  className="shrink-0 rounded-xl bg-rekabetli-primary px-5 py-3 text-sm font-medium text-white transition hover:bg-rekabetli-primary-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isGenerating ? "Üretiliyor…" : "Not üret"}
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
