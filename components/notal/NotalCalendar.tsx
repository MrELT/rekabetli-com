"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

export type CalendarBlock = {
  id: string;
  start_at: string;
  end_at: string;
  title: string;
  notes: string;
  source: string;
  google_event_id: string | null;
};

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString();
}

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("tr-TR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatTimeRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
  };
  const s = new Date(startIso).toLocaleTimeString("tr-TR", opts);
  const e = new Date(endIso).toLocaleTimeString("tr-TR", opts);
  return `${s} – ${e}`;
}

export default function NotalCalendar({
  authFetch,
}: {
  authFetch: AuthFetch;
}) {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeekMonday(new Date()),
  );
  const [expandedDay, setExpandedDay] = useState<string | null>(() =>
    dayKey(new Date()),
  );
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const range = useMemo(() => {
    const from = weekStart;
    const to = addDays(weekStart, 7);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [weekStart]);

  const loadBlocks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch(
        `/api/notal/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      );
      if (!response.ok) {
        setStatus("Planlar yüklenemedi.");
        return;
      }
      const payload = (await response.json()) as { blocks?: CalendarBlock[] };
      setBlocks(payload.blocks ?? []);
    } catch {
      setStatus("Planlar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [authFetch, range.from, range.to]);

  const pullFromGoogle = useCallback(async () => {
    setStatus("Google Takvim çekiliyor…");
    try {
      const response = await authFetch("/api/notal/google/sync", {
        method: "POST",
        body: JSON.stringify({ from: range.from, to: range.to }),
      });
      const payload = (await response.json()) as {
        error?: string;
        imported?: number;
        updated?: number;
      };
      if (!response.ok) {
        setStatus(
          payload.error === "google_not_connected"
            ? "Google bağlı değil."
            : "Google’dan çekilemedi.",
        );
        return;
      }
      await loadBlocks();
      setStatus(
        `Google senkron: ${payload.imported ?? 0} yeni, ${payload.updated ?? 0} güncellendi.`,
      );
    } catch {
      setStatus("Google’dan çekilemedi.");
    }
  }, [authFetch, loadBlocks, range.from, range.to]);

  const loadGoogleStatus = useCallback(async () => {
    try {
      const response = await authFetch("/api/notal/google/status");
      if (!response.ok) return false;
      const payload = (await response.json()) as {
        configured?: boolean;
        connected?: boolean;
      };
      setGoogleConfigured(Boolean(payload.configured));
      setGoogleConnected(Boolean(payload.connected));
      return Boolean(payload.connected);
    } catch {
      return false;
    }
  }, [authFetch]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const connected = await loadGoogleStatus();
      if (cancelled) return;
      if (connected) {
        await pullFromGoogle();
      } else {
        await loadBlocks();
        setStatus("");
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [loadBlocks, loadGoogleStatus, pullFromGoogle]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const google = params.get("google");
    if (!google) return;

    const messages: Record<string, string> = {
      connected: "Google Takvim bağlandı.",
      denied: "Google izni reddedildi.",
      not_configured: "Google OAuth henüz yapılandırılmadı.",
      invalid: "Google dönüşü geçersiz.",
      invalid_state: "Oturum doğrulaması başarısız.",
      error: "Google bağlantısı başarısız.",
    };
    setStatus(messages[google] || "");
    void (async () => {
      const connected = await loadGoogleStatus();
      if (connected) await pullFromGoogle();
    })();

    params.delete("google");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", next);
  }, [loadGoogleStatus, pullFromGoogle]);

  async function connectGoogle() {
    setStatus("Google’a yönlendiriliyor…");
    try {
      const response = await authFetch("/api/notal/google/connect");
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        setStatus(
          payload.error === "google_not_configured"
            ? "Google OAuth env eksik (GOOGLE_CLIENT_ID / SECRET)."
            : "Bağlantı başlatılamadı.",
        );
        return;
      }
      window.location.href = payload.url;
    } catch {
      setStatus("Bağlantı başlatılamadı.");
    }
  }

  async function disconnectGoogle() {
    try {
      await authFetch("/api/notal/google/disconnect", { method: "POST" });
      setGoogleConnected(false);
      setStatus("Google Takvim bağlantısı kesildi.");
    } catch {
      setStatus("Bağlantı kesilemedi.");
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const startLocal = String(form.get("start_at") || "");
    const endLocal = String(form.get("end_at") || "");
    const notes = String(form.get("notes") || "").trim();
    const syncGoogle = form.get("sync_google") === "on";

    if (!title || !startLocal || !endLocal) return;

    setCreating(true);
    try {
      const response = await authFetch("/api/notal/calendar", {
        method: "POST",
        body: JSON.stringify({
          title,
          notes,
          start_at: fromLocalInputValue(startLocal),
          end_at: fromLocalInputValue(endLocal),
          sync_google: syncGoogle,
        }),
      });
      if (!response.ok) {
        setStatus("Blok eklenemedi.");
        return;
      }
      event.currentTarget.reset();
      await loadBlocks();
      setStatus("Plan bloğu eklendi.");
    } catch {
      setStatus("Blok eklenemedi.");
    } finally {
      setCreating(false);
    }
  }

  async function removeBlock(id: string) {
    try {
      const response = await authFetch(
        `/api/notal/calendar?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) return;
      setBlocks((prev) => prev.filter((b) => b.id !== id));
    } catch {
      /* ignore */
    }
  }

  const blocksByDay = useMemo(() => {
    const map = new Map<string, CalendarBlock[]>();
    for (const block of blocks) {
      const key = dayKey(new Date(block.start_at));
      const list = map.get(key) || [];
      list.push(block);
      map.set(key, list);
    }
    return map;
  }, [blocks]);

  const defaultStart = useMemo(() => {
    const base = expandedDay
      ? new Date(`${expandedDay}T09:00:00`)
      : new Date();
    base.setMinutes(0, 0, 0);
    const end = new Date(base);
    end.setHours(end.getHours() + 1);
    return {
      start: toLocalInputValue(base.toISOString()),
      end: toLocalInputValue(end.toISOString()),
    };
  }, [expandedDay]);

  return (
    <section className="notal-calendar" aria-label="Takvim">
      <div className="notal-chat-header">
        <h1 className="notal-chat-title">Takvim</h1>
        <p className="notal-chat-subtitle">
          Günleri genişlet; saatlik planları gör. Planner sohbetten de yazabilir.
        </p>
      </div>

      <div className="notal-cal-toolbar">
        <div className="notal-cal-week-nav">
          <button
            type="button"
            className="notal-cal-nav-btn"
            onClick={() => setWeekStart((d) => addDays(d, -7))}
          >
            ←
          </button>
          <strong>
            {weekStart.toLocaleDateString("tr-TR", {
              day: "numeric",
              month: "long",
            })}{" "}
            –{" "}
            {addDays(weekStart, 6).toLocaleDateString("tr-TR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </strong>
          <button
            type="button"
            className="notal-cal-nav-btn"
            onClick={() => setWeekStart((d) => addDays(d, 7))}
          >
            →
          </button>
          <button
            type="button"
            className="notal-cal-nav-btn"
            onClick={() => setWeekStart(startOfWeekMonday(new Date()))}
          >
            Bu hafta
          </button>
        </div>

        <div className="notal-cal-google">
          {!googleConfigured ? (
            <span className="notal-compose-hint">
              Google OAuth env bekleniyor
            </span>
          ) : googleConnected ? (
            <>
              <span className="notal-cal-google-ok">Google bağlı</span>
              <button
                type="button"
                className="notal-cal-nav-btn"
                onClick={() => void pullFromGoogle()}
              >
                Google’dan yenile
              </button>
              <button
                type="button"
                className="notal-cal-nav-btn"
                onClick={() => void disconnectGoogle()}
              >
                Bağlantıyı kes
              </button>
            </>
          ) : (
            <button
              type="button"
              className="notal-compose-send"
              onClick={() => void connectGoogle()}
            >
              Google Takvim bağla
            </button>
          )}
        </div>
      </div>

      {status ? <p className="notal-cal-status">{status}</p> : null}

      <div className="notal-cal-days">
        {days.map((day) => {
          const key = dayKey(day);
          const open = expandedDay === key;
          const dayBlocks = blocksByDay.get(key) || [];
          return (
            <article
              key={key}
              className={`notal-cal-day${open ? " is-open" : ""}`}
            >
              <button
                type="button"
                className="notal-cal-day-head"
                aria-expanded={open}
                onClick={() => setExpandedDay(open ? null : key)}
              >
                <span>{formatDayLabel(day)}</span>
                <span className="notal-cal-day-count">
                  {dayBlocks.length} plan
                </span>
              </button>

              {open ? (
                <div className="notal-cal-day-body">
                  {loading ? (
                    <p className="notal-conv-empty">Yükleniyor…</p>
                  ) : dayBlocks.length === 0 ? (
                    <p className="notal-conv-empty">Bu gün için plan yok.</p>
                  ) : (
                    <ul className="notal-cal-block-list">
                      {dayBlocks.map((block) => (
                        <li key={block.id} className="notal-cal-block">
                          <div>
                            <strong>{block.title}</strong>
                            <p>
                              {formatTimeRange(block.start_at, block.end_at)}
                              {block.google_event_id ? " · Google" : ""}
                            </p>
                            {block.notes ? (
                              <p className="notal-cal-block-notes">
                                {block.notes}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="notal-conv-delete"
                            aria-label="Sil"
                            onClick={() => void removeBlock(block.id)}
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <form className="notal-cal-create" onSubmit={handleCreate}>
        <h2 className="notal-cal-create-title">Saatlik blok ekle</h2>
        <label>
          Başlık
          <input name="title" required maxLength={160} placeholder="Matematik tekrar" />
        </label>
        <div className="notal-cal-create-row">
          <label>
            Başlangıç
            <input
              name="start_at"
              type="datetime-local"
              required
              defaultValue={defaultStart.start}
            />
          </label>
          <label>
            Bitiş
            <input
              name="end_at"
              type="datetime-local"
              required
              defaultValue={defaultStart.end}
            />
          </label>
        </div>
        <label>
          Not
          <textarea name="notes" rows={2} maxLength={4000} />
        </label>
        {googleConnected ? (
          <label className="notal-cal-sync">
            <input name="sync_google" type="checkbox" />
            Google Takvim’e de yaz
          </label>
        ) : null}
        <button
          type="submit"
          className="notal-compose-send"
          disabled={creating}
        >
          {creating ? "Ekleniyor…" : "Ekle"}
        </button>
      </form>
    </section>
  );
}
