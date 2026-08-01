"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

/** Aynı hafta için gereksiz Google sync’lerini azaltır (sekme değişiminde de yaşar). */
const googleSyncAtByRange = new Map<string, number>();
const GOOGLE_SYNC_TTL_MS = 5 * 60 * 1000;

function googleSyncRangeKey(from: string, to: string) {
  return `${from}|${to}`;
}

function shouldAutoSyncGoogle(from: string, to: string): boolean {
  const last = googleSyncAtByRange.get(googleSyncRangeKey(from, to));
  if (!last) return true;
  return Date.now() - last > GOOGLE_SYNC_TTL_MS;
}

function markGoogleSynced(from: string, to: string) {
  googleSyncAtByRange.set(googleSyncRangeKey(from, to), Date.now());
}

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

function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

function formatWeekdayShort(date: Date): string {
  return date.toLocaleDateString("tr-TR", { weekday: "short" }).replace(".", "");
}

function formatDayNumber(date: Date): string {
  return String(date.getDate());
}

function formatFullDayLabel(date: Date): string {
  return date.toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
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

function formatDurationMinutes(startIso: string, endIso: string): string {
  const mins = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000,
  );
  if (mins < 60) return `${mins} dk`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

function sourceLabel(source: string): string {
  switch (source) {
    case "google":
      return "Google";
    case "manual":
      return "Manuel";
    default:
      return "Planner";
  }
}

export default function NotalCalendar({
  authFetch,
}: {
  authFetch: AuthFetch;
}) {
  const today = useMemo(() => new Date(), []);
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeekMonday(new Date()),
  );
  const [selectedDay, setSelectedDay] = useState<string>(() =>
    dayKey(new Date()),
  );
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const range = useMemo(() => {
    const from = weekStart;
    const to = addDays(weekStart, 7);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [weekStart]);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const googleSyncGenRef = useRef(0);

  const selectedDate = useMemo(() => {
    const found = days.find((day) => dayKey(day) === selectedDay);
    return found || days[0] || new Date();
  }, [days, selectedDay]);

  useEffect(() => {
    const keys = days.map((day) => dayKey(day));
    if (!keys.includes(selectedDay)) {
      const todayKey = dayKey(new Date());
      setSelectedDay(keys.includes(todayKey) ? todayKey : keys[0]!);
    }
  }, [days, selectedDay]);

  const loadBlocks = useCallback(
    async (options?: {
      showLoading?: boolean;
      from?: string;
      to?: string;
    }) => {
      const from = options?.from ?? range.from;
      const to = options?.to ?? range.to;
      const showLoading = options?.showLoading !== false;
      if (showLoading) setLoading(true);
      try {
        const response = await authFetch(
          `/api/notal/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        );
        if (!response.ok) {
          if (
            from === rangeRef.current.from &&
            to === rangeRef.current.to
          ) {
            setStatus("Planlar yüklenemedi.");
          }
          return;
        }
        const payload = (await response.json()) as { blocks?: CalendarBlock[] };
        if (
          from !== rangeRef.current.from ||
          to !== rangeRef.current.to
        ) {
          return;
        }
        setBlocks(payload.blocks ?? []);
      } catch {
        if (
          from === rangeRef.current.from &&
          to === rangeRef.current.to
        ) {
          setStatus("Planlar yüklenemedi.");
        }
      } finally {
        if (
          from === rangeRef.current.from &&
          to === rangeRef.current.to
        ) {
          setLoading(false);
        }
      }
    },
    [authFetch, range.from, range.to],
  );

  const pullFromGoogle = useCallback(
    async (options?: { silent?: boolean; force?: boolean }) => {
      const silent = Boolean(options?.silent);
      const force = Boolean(options?.force);
      const from = range.from;
      const to = range.to;

      if (!force && !shouldAutoSyncGoogle(from, to)) {
        return;
      }

      const syncGen = ++googleSyncGenRef.current;
      setSyncingGoogle(true);
      if (!silent) setStatus("Google Takvim çekiliyor…");

      try {
        const response = await authFetch("/api/notal/google/sync", {
          method: "POST",
          body: JSON.stringify({ from, to }),
        });
        const payload = (await response.json()) as {
          error?: string;
          imported?: number;
          updated?: number;
        };

        const stillCurrent =
          syncGen === googleSyncGenRef.current &&
          from === rangeRef.current.from &&
          to === rangeRef.current.to;

        if (!response.ok) {
          if (!silent && stillCurrent) {
            setStatus(
              payload.error === "google_not_connected"
                ? "Google bağlı değil."
                : "Google’dan çekilemedi.",
            );
          }
          return;
        }

        markGoogleSynced(from, to);
        if (!stillCurrent) return;

        await loadBlocks({ showLoading: false, from, to });

        if (!silent && syncGen === googleSyncGenRef.current) {
          setStatus(
            `Senkron tamam: ${payload.imported ?? 0} yeni, ${payload.updated ?? 0} güncellendi.`,
          );
        }
      } catch {
        if (
          !silent &&
          syncGen === googleSyncGenRef.current &&
          from === rangeRef.current.from &&
          to === rangeRef.current.to
        ) {
          setStatus("Google’dan çekilemedi.");
        }
      } finally {
        if (syncGen === googleSyncGenRef.current) {
          setSyncingGoogle(false);
        }
      }
    },
    [authFetch, loadBlocks, range.from, range.to],
  );

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
    const handler = () => {
      void loadBlocks();
    };
    window.addEventListener("notal-calendar-refresh", handler);
    return () => window.removeEventListener("notal-calendar-refresh", handler);
  }, [loadBlocks]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      // Önce yerel DB’deki son planları göster; Google sync’i bekletme.
      await loadBlocks({ showLoading: true });
      if (cancelled) return;

      const connected = await loadGoogleStatus();
      if (cancelled) return;
      if (!connected) {
        setStatus("");
        return;
      }

      void pullFromGoogle({ silent: true });
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
      await loadBlocks({ showLoading: true });
      const connected = await loadGoogleStatus();
      if (connected) await pullFromGoogle({ force: true });
    })();

    params.delete("google");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", next);
  }, [loadBlocks, loadGoogleStatus, pullFromGoogle]);

  function goToToday() {
    const now = new Date();
    setWeekStart(startOfWeekMonday(now));
    setSelectedDay(dayKey(now));
  }

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
        }),
      });
      if (!response.ok) {
        setStatus("Blok eklenemedi.");
        return;
      }
      event.currentTarget.reset();
      await loadBlocks();
      setStatus("Plan eklendi.");
      setShowCreateForm(false);
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
    for (const [, list] of map) {
      list.sort(
        (a, b) =>
          new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
      );
    }
    return map;
  }, [blocks]);

  const selectedDayBlocks = blocksByDay.get(selectedDay) || [];
  const weekTotal = blocks.length;

  const defaultStart = useMemo(() => {
    const base = selectedDay
      ? new Date(`${selectedDay}T09:00:00`)
      : new Date();
    base.setMinutes(0, 0, 0);
    const end = new Date(base);
    end.setHours(end.getHours() + 1);
    return {
      start: toLocalInputValue(base.toISOString()),
      end: toLocalInputValue(end.toISOString()),
    };
  }, [selectedDay]);

  return (
    <section className="notal-calendar" aria-label="Takvim">
      <header className="notal-cal-hero">
        <div>
          <h1 className="notal-chat-title">Takvim</h1>
          <p className="notal-chat-subtitle">
            Haftalık planını görüntüle ve düzenle.
            {googleConnected
              ? " Google Takvim otomatik senkronize edilir."
              : " Google bağlayarak telefon takviminle eşitleyebilirsin."}
          </p>
        </div>
        <div className="notal-cal-hero-stats">
          <span className="notal-cal-stat">
            <strong>{weekTotal}</strong>
            <span>bu hafta</span>
          </span>
          <span className="notal-cal-stat">
            <strong>{selectedDayBlocks.length}</strong>
            <span>seçili gün</span>
          </span>
        </div>
      </header>

      <div className="notal-cal-toolbar-card">
        <div className="notal-cal-week-nav">
          <button
            type="button"
            className="notal-cal-icon-btn"
            aria-label="Önceki hafta"
            onClick={() => setWeekStart((d) => addDays(d, -7))}
          >
            ‹
          </button>
          <div className="notal-cal-week-label">
            <span className="notal-cal-week-label-main">
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
            </span>
          </div>
          <button
            type="button"
            className="notal-cal-icon-btn"
            aria-label="Sonraki hafta"
            onClick={() => setWeekStart((d) => addDays(d, 7))}
          >
            ›
          </button>
          <button
            type="button"
            className="notal-cal-pill-btn"
            onClick={goToToday}
          >
            Bugün
          </button>
        </div>

        <div className="notal-cal-google">
          {!googleConfigured ? (
            <span className="notal-cal-hint">Google OAuth bekleniyor</span>
          ) : googleConnected ? (
            <>
              <span className="notal-cal-google-badge">
                <span className="notal-cal-google-dot" aria-hidden="true" />
                Google bağlı
              </span>
              <button
                type="button"
                className="notal-cal-pill-btn"
                disabled={syncingGoogle}
                onClick={() => void pullFromGoogle({ force: true })}
              >
                {syncingGoogle ? "Güncelleniyor…" : "Yenile"}
              </button>
              <button
                type="button"
                className="notal-cal-pill-btn notal-cal-pill-btn--ghost"
                onClick={() => void disconnectGoogle()}
              >
                Bağlantıyı kes
              </button>
            </>
          ) : (
            <button
              type="button"
              className="notal-cal-connect-btn"
              onClick={() => void connectGoogle()}
            >
              Google Takvim bağla
            </button>
          )}
        </div>
      </div>

      {status ? (
        <div className="notal-cal-status-banner" role="status">
          {status}
        </div>
      ) : null}

      <div className="notal-cal-week-grid" role="tablist" aria-label="Hafta günleri">
        {days.map((day) => {
          const key = dayKey(day);
          const count = blocksByDay.get(key)?.length || 0;
          const selected = selectedDay === key;
          const todayMark = isSameDay(day, today);
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`notal-cal-week-day${selected ? " is-selected" : ""}${todayMark ? " is-today" : ""}`}
              onClick={() => setSelectedDay(key)}
            >
              <span className="notal-cal-week-day-name">
                {formatWeekdayShort(day)}
              </span>
              <span className="notal-cal-week-day-num">
                {formatDayNumber(day)}
              </span>
              {count > 0 ? (
                <span className="notal-cal-week-day-count">{count}</span>
              ) : (
                <span className="notal-cal-week-day-empty" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      <div className="notal-cal-layout">
        <div className="notal-cal-day-panel">
          <div className="notal-cal-day-panel-head">
            <div>
              <h2 className="notal-cal-day-title">
                {formatFullDayLabel(selectedDate)}
              </h2>
              <p className="notal-cal-day-meta">
                {loading
                  ? "Yükleniyor…"
                  : syncingGoogle
                    ? selectedDayBlocks.length
                      ? `${selectedDayBlocks.length} plan · Google güncelleniyor…`
                      : "Google güncelleniyor…"
                    : selectedDayBlocks.length
                      ? `${selectedDayBlocks.length} plan`
                      : "Bu gün için plan yok"}
              </p>
            </div>
            <button
              type="button"
              className="notal-cal-add-btn"
              onClick={() => setShowCreateForm((open) => !open)}
            >
              {showCreateForm ? "Kapat" : "+ Plan ekle"}
            </button>
          </div>

          {loading ? (
            <div className="notal-cal-skeleton-list" aria-hidden="true">
              <div className="notal-cal-skeleton" />
              <div className="notal-cal-skeleton" />
              <div className="notal-cal-skeleton notal-cal-skeleton--short" />
            </div>
          ) : selectedDayBlocks.length === 0 ? (
            <div className="notal-cal-empty">
              <p className="notal-cal-empty-title">Henüz plan yok</p>
              <p className="notal-cal-empty-text">
                Bu güne çalışma bloğu ekleyebilir veya sohbetten Planner’a
                plan yaptırabilirsin.
              </p>
              <button
                type="button"
                className="notal-cal-add-btn notal-cal-add-btn--inline"
                onClick={() => setShowCreateForm(true)}
              >
                İlk planı ekle
              </button>
            </div>
          ) : (
            <ul className="notal-cal-timeline">
              {selectedDayBlocks.map((block) => (
                <li
                  key={block.id}
                  className={`notal-cal-event notal-cal-event--${block.source}`}
                >
                  <div className="notal-cal-event-rail" aria-hidden="true" />
                  <div className="notal-cal-event-body">
                    <div className="notal-cal-event-top">
                      <span className="notal-cal-event-time">
                        {formatTimeRange(block.start_at, block.end_at)}
                      </span>
                      <span className="notal-cal-event-duration">
                        {formatDurationMinutes(block.start_at, block.end_at)}
                      </span>
                      <span
                        className={`notal-cal-event-source notal-cal-event-source--${block.source}`}
                      >
                        {block.google_event_id ? "Google" : sourceLabel(block.source)}
                      </span>
                    </div>
                    <h3 className="notal-cal-event-title">{block.title}</h3>
                    {block.notes ? (
                      <p className="notal-cal-event-notes">{block.notes}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="notal-cal-event-delete"
                    aria-label={`${block.title} planını sil`}
                    onClick={() => void removeBlock(block.id)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {showCreateForm ? (
          <form className="notal-cal-create" onSubmit={handleCreate}>
            <h2 className="notal-cal-create-title">Yeni plan</h2>
            <p className="notal-cal-create-sub">
              {formatFullDayLabel(selectedDate)} için saatlik blok
            </p>
            <label className="notal-cal-field">
              <span>Başlık</span>
              <input
                name="title"
                required
                maxLength={160}
                placeholder="Matematik tekrar"
              />
            </label>
            <div className="notal-cal-create-row">
              <label className="notal-cal-field">
                <span>Başlangıç</span>
                <input
                  name="start_at"
                  type="datetime-local"
                  required
                  defaultValue={defaultStart.start}
                />
              </label>
              <label className="notal-cal-field">
                <span>Bitiş</span>
                <input
                  name="end_at"
                  type="datetime-local"
                  required
                  defaultValue={defaultStart.end}
                />
              </label>
            </div>
            <label className="notal-cal-field">
              <span>Not (isteğe bağlı)</span>
              <textarea name="notes" rows={3} maxLength={4000} />
            </label>
            <div className="notal-cal-create-actions">
              <button
                type="button"
                className="notal-cal-pill-btn notal-cal-pill-btn--ghost"
                onClick={() => setShowCreateForm(false)}
              >
                Vazgeç
              </button>
              <button
                type="submit"
                className="notal-compose-send"
                disabled={creating}
              >
                {creating ? "Ekleniyor…" : "Kaydet"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
