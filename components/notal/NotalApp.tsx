"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createNotalAuthBrowserClient } from "@/lib/notal/auth-browser";
import NotalCalendar from "@/components/notal/NotalCalendar";

type ChatRole = "user" | "assistant" | "system";
type AppView = "asistan" | "takvim";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ConversationItem = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function friendlyError(code: string): string {
  switch (code) {
    case "auth_required":
      return "Oturum gerekli. Yeniden giriş yap.";
    case "openai_not_configured":
      return "OpenAI API anahtarı tanımlı değil (.env → OPENAI_API_KEY).";
    case "invalid_messages":
      return "Mesaj gönderilemedi.";
    case "conversation_not_found":
      return "Sohbet bulunamadı.";
    case "persist_failed":
      return "Sohbet kaydedilemedi.";
    case "list_failed":
      return "Sohbet listesi yüklenemedi.";
    case "aborted":
      return "İstek iptal edildi.";
    default:
      return "Yanıt alınamadı. Biraz sonra tekrar dene.";
  }
}

async function getAccessToken(): Promise<string | null> {
  const supabase = createNotalAuthBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error("auth_required");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(path, { ...init, headers });
}

export default function NotalApp() {
  const [activeView, setActiveView] = useState<AppView>("asistan");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [toolHint, setToolHint] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "takvim") {
      setActiveView("takvim");
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const response = await authFetch("/api/notal/conversations");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        conversations?: ConversationItem[];
      };
      setConversations(payload.conversations ?? []);
    } catch {
      /* ignore list errors in UI shell */
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function closeSidebar() {
    setSidebarOpen(false);
  }

  function startNewChat() {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setDraft("");
    setSending(false);
    closeSidebar();
    inputRef.current?.focus();
  }

  async function openConversation(id: string) {
    if (sending || id === conversationId) {
      closeSidebar();
      return;
    }

    setLoadingThread(true);
    closeSidebar();
    try {
      const response = await authFetch(`/api/notal/conversations/${id}`);
      if (!response.ok) {
        setMessages([
          {
            id: createId(),
            role: "system",
            content: friendlyError(
              response.status === 404 ? "conversation_not_found" : "list_failed",
            ),
          },
        ]);
        return;
      }

      const payload = (await response.json()) as {
        conversation: ConversationItem;
        messages: Array<{
          id: string;
          role: "user" | "assistant";
          content: string;
        }>;
      };

      setConversationId(payload.conversation.id);
      setMessages(
        payload.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
        })),
      );
    } catch {
      setMessages([
        {
          id: createId(),
          role: "system",
          content: friendlyError("orchestrator_error"),
        },
      ]);
    } finally {
      setLoadingThread(false);
      inputRef.current?.focus();
    }
  }

  async function removeConversation(id: string) {
    try {
      const response = await authFetch(`/api/notal/conversations/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) return;
      setConversations((prev) => prev.filter((item) => item.id !== id));
      if (conversationId === id) {
        startNewChat();
      }
    } catch {
      /* ignore */
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || loadingThread) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: text,
    };
    const assistantId = createId();
    const historyForApi = [...messages, userMessage]
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    setDraft("");
    setSending(true);
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await authFetch("/api/notal/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: historyForApi,
          conversationId,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        let code = "orchestrator_error";
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) code = payload.error;
        } catch {
          /* ignore */
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, role: "system", content: friendlyError(code) }
              : m,
          ),
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";
      let activeConversationId = conversationId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const line = chunk
            .split("\n")
            .map((part) => part.trim())
            .find((part) => part.startsWith("data:"));
          if (!line) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;

          let event: {
            type?: string;
            text?: string;
            message?: string;
            name?: string;
            conversationId?: string;
            conversationCreated?: boolean;
          };
          try {
            event = JSON.parse(raw) as typeof event;
          } catch {
            continue;
          }

          if (event.type === "meta" && event.conversationId) {
            activeConversationId = event.conversationId;
            setConversationId(event.conversationId);
            if (event.conversationCreated) {
              setConversations((prev) => {
                if (prev.some((item) => item.id === event.conversationId)) {
                  return prev;
                }
                const now = new Date().toISOString();
                return [
                  {
                    id: event.conversationId!,
                    title:
                      text.length > 60 ? `${text.slice(0, 57)}…` : text,
                    created_at: now,
                    updated_at: now,
                  },
                  ...prev,
                ];
              });
            }
          } else if (event.type === "tool_start" && event.name) {
            setToolHint(`Planner çalışıyor: ${event.name}`);
          } else if (event.type === "tool_done" && event.name) {
            setToolHint(`Planner tamamladı: ${event.name}`);
          } else if (event.type === "delta" && event.text) {
            assembled += event.text;
            const snapshot = assembled;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: snapshot } : m,
              ),
            );
          } else if (event.type === "error") {
            const msg = friendlyError(event.message || "orchestrator_error");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      role: assembled ? "assistant" : "system",
                      content: assembled || msg,
                    }
                  : m,
              ),
            );
          } else if (event.type === "done" && event.conversationId) {
            activeConversationId = event.conversationId;
            setConversationId(event.conversationId);
          }
        }
      }

      if (!assembled) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  role: "system",
                  content: "Boş yanıt geldi. Tekrar dener misin?",
                }
              : m,
          ),
        );
      }

      if (activeConversationId) {
        void refreshConversations();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const code =
        error instanceof Error && error.message === "auth_required"
          ? "auth_required"
          : "orchestrator_error";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, role: "system", content: friendlyError(code) }
            : m,
        ),
      );
    } finally {
      setSending(false);
      setToolHint("");
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className={`notal-page${sidebarOpen ? " is-sidebar-open" : ""}`}>
      <header className="notal-topnav">
        <a className="notal-brand" href="/">
          <img
            src="/assets/rekabetli.png"
            alt="Rekabetli"
            className="notal-brand-logo"
          />
        </a>
        <div className="notal-topnav-actions">
          <a className="notal-home-btn" href="/" aria-label="Ana sayfa">
            <span aria-hidden="true">⌂</span>
            <span>Ana Sayfa</span>
          </a>
        </div>
      </header>

      <div className="notal-shell">
        <button
          type="button"
          className="notal-mobile-toggle"
          aria-expanded={sidebarOpen}
          aria-controls="notal-sidebar"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          Menü
        </button>

        <button
          type="button"
          className="notal-sidebar-backdrop"
          aria-label="Menüyü kapat"
          tabIndex={sidebarOpen ? 0 : -1}
          onClick={closeSidebar}
        />

        <aside
          id="notal-sidebar"
          className="notal-sidebar"
          aria-label="NotAl menüsü"
        >
          <p className="notal-sidebar-title">NotAl</p>
          <nav className="notal-nav">
            <button
              type="button"
              className={`notal-nav-btn${activeView === "asistan" ? " is-active" : ""}`}
              aria-current={activeView === "asistan" ? "page" : undefined}
              onClick={() => {
                setActiveView("asistan");
                closeSidebar();
              }}
            >
              Asistanım
            </button>
            <button
              type="button"
              className={`notal-nav-btn${activeView === "takvim" ? " is-active" : ""}`}
              aria-current={activeView === "takvim" ? "page" : undefined}
              onClick={() => {
                setActiveView("takvim");
                closeSidebar();
              }}
            >
              Takvim
            </button>

            {activeView === "asistan" ? (
              <>
                <button
                  type="button"
                  className="notal-new-chat-btn"
                  onClick={startNewChat}
                  disabled={sending}
                >
                  + Yeni sohbet
                </button>

                <div className="notal-conv-list" aria-label="Sohbet geçmişi">
                  {loadingList ? (
                    <p className="notal-conv-empty">Sohbetler yükleniyor…</p>
                  ) : conversations.length === 0 ? (
                    <p className="notal-conv-empty">Henüz kayıtlı sohbet yok.</p>
                  ) : (
                    conversations.map((item) => {
                      const active = item.id === conversationId;
                      return (
                        <div
                          key={item.id}
                          className={`notal-conv-item${active ? " is-active" : ""}`}
                        >
                          <button
                            type="button"
                            className="notal-conv-open"
                            onClick={() => void openConversation(item.id)}
                            disabled={sending || loadingThread}
                            title={item.title}
                          >
                            {item.title}
                          </button>
                          <button
                            type="button"
                            className="notal-conv-delete"
                            aria-label="Sohbeti sil"
                            disabled={sending}
                            onClick={() => void removeConversation(item.id)}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <p className="notal-conv-empty">
                Planner günlük/haftalık planları buraya yazar. Sohbetten de
                plan isteyebilirsin.
              </p>
            )}
          </nav>
        </aside>

        <div className="notal-content">
          {activeView === "takvim" ? (
            <div className="notal-chat">
              <NotalCalendar authFetch={authFetch} />
            </div>
          ) : (
          <section className="notal-chat" aria-label="Asistanım">
            <div className="notal-chat-header">
              <h1 className="notal-chat-title">Asistanım</h1>
              <p className="notal-chat-subtitle">
                Orchestrator + Planner — örn. “yarın için 3 saatlik çalışma planı yap”
              </p>
            </div>

            <div ref={listRef} className="notal-chat-messages" role="log">
              {loadingThread ? (
                <div className="notal-chat-empty">
                  <p className="notal-chat-empty-text">Sohbet yükleniyor…</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="notal-chat-empty">
                  <p className="notal-chat-empty-title">Sohbete başla</p>
                  <p className="notal-chat-empty-text">
                    İlk mesajın yeni bir sohbet oluşturur. Geçmiş solda görünür.
                  </p>
                </div>
              ) : (
                messages.map((message) => (
                  <article
                    key={message.id}
                    className={`notal-bubble notal-bubble--${message.role}${
                      message.role === "assistant" &&
                      sending &&
                      message.content === ""
                        ? " is-pending"
                        : ""
                    }`}
                  >
                    <p className="notal-bubble-role">
                      {message.role === "user"
                        ? "Sen"
                        : message.role === "assistant"
                          ? "NotAl"
                          : "Sistem"}
                    </p>
                    <p className="notal-bubble-text">
                      {message.content ||
                        (message.role === "assistant" && sending ? "…" : "")}
                    </p>
                  </article>
                ))
              )}
            </div>

            <form className="notal-compose" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="notal-compose-input">
                Mesajın
              </label>
              <textarea
                id="notal-compose-input"
                ref={inputRef}
                className="notal-compose-input"
                rows={2}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Mesajını yaz… (Enter gönder, Shift+Enter satır)"
                maxLength={4000}
                disabled={sending || loadingThread}
              />
              <div className="notal-compose-actions">
                <span className="notal-compose-hint">
                  {sending
                    ? toolHint || "Yanıt yazılıyor…"
                    : conversationId
                      ? "Kayıtlı sohbet"
                      : "Yeni sohbet"}
                </span>
                <button
                  type="submit"
                  className="notal-compose-send"
                  disabled={sending || loadingThread || !draft.trim()}
                >
                  {sending ? "Bekle" : "Gönder"}
                </button>
              </div>
            </form>
          </section>
          )}
        </div>
      </div>
    </div>
  );
}
