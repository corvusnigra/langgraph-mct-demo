"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { parseApiJson } from "@/src/lib/parse-api-response";

type UserInfo = { id: string; email: string; role: string };

type Msg = { role: "user" | "assistant"; text: string };

const MCT_CHIPS = [
  "Что такое CAS?",
  "Упражнение при тревоге",
  "Отстранённое внимание",
  "Беспокойство и руминация",
];

const ACT_CHIPS = [
  "Что такое расцепление?",
  "Упражнение на ценности",
  "Листья на реке",
  "Как принять тревогу?",
];

const MODALITY_META = {
  mct: {
    title: "Метакогнитивная терапия",
    description:
      "Исследуйте роль метапознания в тревоге и руминации. Задайте вопрос или выберите тему.",
    chips: MCT_CHIPS,
  },
  act: {
    title: "Терапия принятия и ответственности",
    description:
      "Работайте с ценностями, принятием и психологической гибкостью. Выберите тему для начала.",
    chips: ACT_CHIPS,
  },
};

export default function ChatPage() {
  /** Только на клиенте после mount — иначе SSR и гидратация расходятся (React #418). */
  const [tid, setTid] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interruptOpen, setInterruptOpen] = useState(false);
  const [interruptPayload, setInterruptPayload] = useState<unknown>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [modality, setModality] = useState<"mct" | "act">("mct");
  const [historyLoading, setHistoryLoading] = useState(true); // #11
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollDown = () =>
    endRef.current?.scrollIntoView({ behavior: "smooth" });

  // userId ref для использования внутри callbacks без пересоздания
  const userIdRef = useRef<string>("");

  // threadKey — ключ localStorage с namespace по userId
  const threadKey = (mod: "mct" | "act") =>
    userIdRef.current
      ? `mct_thread_${userIdRef.current}_${mod}`
      : `mct_thread_id_${mod}`;

  const loadHistory = useCallback(async (tid: string, mod: "mct" | "act") => {
    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/history?threadId=${tid}`);
      const data = r.ok ? (await r.json()) as { messages?: Msg[]; foreign?: boolean } : null;
      if (data?.foreign) {
        // Тред принадлежит другому пользователю — сбрасываем
        const newTid = crypto.randomUUID();
        localStorage.setItem(threadKey(mod), newTid);
        setTid(newTid);
        setMessages([]);
      } else if (data?.messages?.length) {
        setMessages(data.messages);
      }
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Инициализация: сначала грузим юзера, потом threadId с namespace по userId
  useEffect(() => {
    const init = async () => {
      // 1. Загружаем текущего пользователя
      try {
        const r = await fetch("/api/auth/me");
        const data = r.ok ? (await r.json()) as { user: UserInfo | null } : null;
        if (data?.user) {
          setUser(data.user);
          userIdRef.current = data.user.id;
        }
      } catch { /* ignore */ }

      // 2. Восстанавливаем модальность
      const savedModality =
        (localStorage.getItem("mct_modality") as "mct" | "act") ?? "mct";
      setModality(savedModality);

      // 3. threadId с namespace по userId
      const key = threadKey(savedModality);
      const savedTid = localStorage.getItem(key) ?? crypto.randomUUID();
      localStorage.setItem(key, savedTid);
      setTid(savedTid);

      // 4. Загружаем историю с проверкой владельца
      await loadHistory(savedTid, savedModality);
    };
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNewChat = useCallback(
    (mod: "mct" | "act" = modality) => {
      const newTid = crypto.randomUUID();
      localStorage.setItem(threadKey(mod), newTid);
      setTid(newTid);
      setMessages([]);
      setError(null);
      setInterruptOpen(false);
      setInterruptPayload(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modality]
  );

  const switchModality = useCallback(
    (mod: "mct" | "act") => {
      if (mod === modality) return;
      localStorage.setItem("mct_modality", mod);
      setModality(mod);
      setMessages([]);
      setError(null);
      setInterruptOpen(false);
      setInterruptPayload(null);

      const key = threadKey(mod);
      const savedTid = localStorage.getItem(key) ?? crypto.randomUUID();
      localStorage.setItem(key, savedTid);
      setTid(savedTid);

      void loadHistory(savedTid, mod);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modality, loadHistory]
  );

  useEffect(() => {
    scrollDown();
  }, [messages, loading]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !tid) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: tid, message: text, modality }),
      });
      const data = await parseApiJson<{
        reply?: string;
        interrupted?: boolean;
        interruptPayload?: unknown;
        error?: string;
      }>(res);
      if (!res.ok) {
        setError(data.error ?? res.statusText);
        return;
      }
      if (data.interrupted) {
        setInterruptOpen(true);
        setInterruptPayload(data.interruptPayload ?? null);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: "⏸ Ожидается решение по домашнему плану (панель ниже).",
          },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: data.reply ?? "(пусто)" },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setLoading(false);
    }
  }, [input, loading, tid, modality]);

  const resume = useCallback(
    async (value: string) => {
      if (!tid) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: tid, resume: value }),
        });
        const data = await parseApiJson<{ reply?: string; error?: string }>(
          res
        );
        if (!res.ok) {
          setError(data.error ?? res.statusText);
          return;
        }
        setInterruptOpen(false);
        setInterruptPayload(null);
        setMessages((m) => [
          ...m,
          { role: "assistant", text: data.reply ?? "(пусто)" },
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка сети");
      } finally {
        setLoading(false);
      }
    },
    [tid]
  );

  const meta = MODALITY_META[modality];

  return (
    <div className="chat-shell" data-modality={modality}>
      {/* ── Nav bar ── */}
      <nav className="chat-nav" aria-label="Навигация">
        <div className="chat-nav__logo">
          <span className="chat-nav__logo-mark" aria-hidden="true" />
          <span className="chat-nav__logo-text">Консультант</span>
        </div>

        <div
          className="chat-nav__toggle"
          role="group"
          aria-label="Выбор подхода"
        >
          <button
            type="button"
            className={`chat-nav__seg${modality === "mct" ? " chat-nav__seg--active" : ""}`}
            onClick={() => switchModality("mct")}
            disabled={loading}
            aria-pressed={modality === "mct"}
          >
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#5b9fd4", marginRight: "0.4rem", verticalAlign: "middle", opacity: modality === "mct" ? 1 : 0.5 }} aria-hidden="true" />
            МКТ
          </button>
          <button
            type="button"
            className={`chat-nav__seg${modality === "act" ? " chat-nav__seg--active" : ""}`}
            onClick={() => switchModality("act")}
            disabled={loading}
            aria-pressed={modality === "act"}
          >
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#4db8a0", marginRight: "0.4rem", verticalAlign: "middle", opacity: modality === "act" ? 1 : 0.5 }} aria-hidden="true" />
            ACT
          </button>
        </div>

        <div className="chat-nav__right">
          {user && (
            <>
              <span className="chat-nav__email" title={user.email}>
                {user.email}
              </span>
              {(user.role === "therapist" || user.role === "admin") && (
                <a
                  href="/therapist"
                  className="mct-btn mct-btn--ghost mct-btn--sm"
                >
                  Дашборд
                </a>
              )}
              <button
                type="button"
                className="mct-btn mct-btn--ghost mct-btn--sm"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  // threadId не удаляем — ключи namespaced по userId,
                  // история восстановится при следующем входе
                  window.location.href = "/login";
                }}
              >
                Выйти
              </button>
            </>
          )}
        </div>
      </nav>

      {/* ── Error banner ── */}
      {error && (
        <div className="chat-error-banner" role="alert">
          <span className="chat-error-banner__icon" aria-hidden="true">!</span>
          {error}
        </div>
      )}

      {/* ── Chat area ── */}
      <main
        className={`chat-area${loading ? " chat-area--thinking" : ""}`}
        aria-label="Лента сообщений"
      >
        {/* Thinking bar — 2px shimmer у верхнего края */}
        <div
          className={`chat-thinking-bar${loading ? " chat-thinking-bar--active" : ""}`}
          aria-hidden="true"
        />

        <div className="chat-scroll" role="log" aria-live="polite">
          {/* Empty state / skeleton */}
          {historyLoading ? (
            // #11: skeleton пока история не загружена
            <div className="chat-empty" aria-busy="true">
              <div className="chat-skeleton-line" aria-hidden="true" />
              <div className="chat-skeleton-line chat-skeleton-line--sm" aria-hidden="true" />
            </div>
          ) : messages.length === 0 && !loading ? (
            <div className="chat-empty">
              <p className="chat-empty__title">{meta.title}</p>
              <p className="chat-empty__desc">{meta.description}</p>
              <div className="chat-empty__chips" role="list">
                {meta.chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    role="listitem"
                    className="chat-empty__chip"
                    onClick={() => {
                      setInput(chip);
                      inputRef.current?.focus();
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Messages */}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`chat-msg${msg.role === "user" ? " chat-msg--user" : " chat-msg--bot"}`}
            >
              <div className={`chat-avatar chat-avatar--${msg.role === "user" ? "user" : "bot"}`} aria-hidden="true">
                {msg.role === "user" ? (
                  user?.email?.charAt(0).toUpperCase() ?? "U"
                ) : (
                  <svg viewBox="0 0 24 24"><path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/></svg>
                )}
              </div>
              <div className="chat-bubble">
                {msg.role === "assistant" ? (
                  // #9: рендер markdown для ответов ассистента
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                ) : (
                  msg.text
                )}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="chat-msg chat-msg--bot" role="status">
              <div className="chat-avatar chat-avatar--bot" aria-hidden="true">
                 <svg viewBox="0 0 24 24"><path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/></svg>
              </div>
              <div className="chat-bubble chat-bubble--typing" aria-label="Печатает ответ">

                <span className="chat-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </div>
          )}

          <div ref={endRef} aria-hidden="true" />
        </div>
      </main>

      {/* ── Interrupt panel ── */}
      {interruptOpen && (() => {
        // #10: структурированная карточка вместо сырого JSON
        type HwPayload = {
          action?: string;
          exercise_id?: string;
          client_name?: string;
          email?: string;
          homework_summary?: string;
          weekly_sessions?: string | null;
          exercise?: { title?: string; duration_min?: number; modality?: string; focus_tags?: string[] };
        };
        const p = (interruptPayload ?? {}) as HwPayload;
        return (
          <section
            className="chat-interrupt"
            aria-labelledby="hw-confirm-title"
          >
            <p className="chat-interrupt__label" id="hw-confirm-title">
              <span className="chat-interrupt__icon" aria-hidden="true">⏸</span>
              Подтверждение домашнего плана
            </p>
            {p.exercise ? (
              <div className="chat-interrupt__card">
                {p.exercise.title && <p className="chat-interrupt__card-title">{p.exercise.title}</p>}
                {p.homework_summary && <p><strong>Задание:</strong> {p.homework_summary}</p>}
                {p.exercise.duration_min != null && <p><strong>Длительность:</strong> ~{p.exercise.duration_min} мин</p>}
                {p.weekly_sessions && <p><strong>Частота:</strong> {p.weekly_sessions}</p>}
                {p.client_name && <p><strong>Клиент:</strong> {p.client_name}</p>}
                {p.email && <p><strong>Email:</strong> {p.email}</p>}
              </div>
            ) : (
              <pre className="chat-interrupt__pre">
                {interruptPayload != null
                  ? JSON.stringify(interruptPayload, null, 2)
                  : "Детали плана не переданы."}
              </pre>
            )}
            <div className="chat-interrupt__actions">
              <button
                type="button"
                disabled={loading}
                onClick={() => resume("approved")}
                className="mct-btn mct-btn--primary"
              >
                Одобрить
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => resume("rejected")}
                className="mct-btn mct-btn--ghost"
              >
                Отклонить
              </button>
            </div>
          </section>
        );
      })()}

      {/* ── Footer: session badge + composer ── */}
      <footer className="chat-footer">
        <div className="chat-footer__inner">
          <div className="chat-footer__meta">
            <span className="chat-session-dot" aria-hidden="true" />
            <span className="chat-session-id" title={tid ?? undefined}>
              {tid ? `${tid.slice(0, 8)}…${tid.slice(-4)}` : "…"}
            </span>
            <button
              type="button"
              className="chat-new-btn"
              onClick={() => startNewChat()}
              disabled={loading}
              aria-label="Начать новый чат"
            >
              Новый чат
            </button>
          </div>

          <div className="chat-composer">
            <textarea
              ref={inputRef as any}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!loading && !interruptOpen && tid && input.trim()) {
                    sendMessage();
                    if (inputRef.current) (inputRef.current as any).style.height = "auto";
                  }
                }
              }}
              placeholder="Напишите сообщение…"
              disabled={loading || interruptOpen || !tid}
              className="chat-composer__input"
              aria-label="Текст сообщения"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => {
                sendMessage();
                if (inputRef.current) (inputRef.current as any).style.height = "auto";
              }}
              disabled={!input.trim() || loading || interruptOpen || !tid}
              className="chat-composer__send"
              aria-label="Отправить сообщение"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M9 15V3M9 3L4 8M9 3L14 8"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
