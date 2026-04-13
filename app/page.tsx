"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollDown = () =>
    endRef.current?.scrollIntoView({ behavior: "smooth" });

  // Восстанавливаем модальность, threadId и историю из localStorage/checkpointer'а
  useEffect(() => {
    const savedModality =
      (localStorage.getItem("mct_modality") as "mct" | "act") ?? "mct";
    setModality(savedModality);

    const key = `mct_thread_id_${savedModality}`;
    const savedTid = localStorage.getItem(key) ?? crypto.randomUUID();
    localStorage.setItem(key, savedTid);
    setTid(savedTid);

    fetch(`/api/history?threadId=${savedTid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { messages?: Msg[] } | null) => {
        if (data?.messages?.length) setMessages(data.messages);
      })
      .catch(() => null);
  }, []);

  const startNewChat = useCallback(
    (mod: "mct" | "act" = modality) => {
      const newTid = crypto.randomUUID();
      localStorage.setItem(`mct_thread_id_${mod}`, newTid);
      setTid(newTid);
      setMessages([]);
      setError(null);
      setInterruptOpen(false);
      setInterruptPayload(null);
    },
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

      const key = `mct_thread_id_${mod}`;
      const savedTid = localStorage.getItem(key) ?? crypto.randomUUID();
      localStorage.setItem(key, savedTid);
      setTid(savedTid);

      fetch(`/api/history?threadId=${savedTid}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { messages?: Msg[] } | null) => {
          if (data?.messages?.length) setMessages(data.messages);
        })
        .catch(() => null);
    },
    [modality]
  );

  useEffect(() => {
    fetch("/api/users/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data as UserInfo | null))
      .catch(() => null);
  }, []);

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
            МКТ
          </button>
          <button
            type="button"
            className={`chat-nav__seg${modality === "act" ? " chat-nav__seg--active" : ""}`}
            onClick={() => switchModality("act")}
            disabled={loading}
            aria-pressed={modality === "act"}
          >
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
          {/* Empty state */}
          {messages.length === 0 && !loading && (
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
          )}

          {/* Messages */}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`chat-msg${msg.role === "user" ? " chat-msg--user" : " chat-msg--bot"}`}
            >
              <div className="chat-bubble">{msg.text}</div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="chat-msg chat-msg--bot" role="status">
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
      {interruptOpen && (
        <section
          className="chat-interrupt"
          aria-labelledby="hw-confirm-title"
        >
          <p className="chat-interrupt__label" id="hw-confirm-title">
            <span className="chat-interrupt__icon" aria-hidden="true">⏸</span>
            Подтверждение домашнего плана
          </p>
          <pre className="chat-interrupt__pre">
            {interruptPayload != null
              ? JSON.stringify(interruptPayload, null, 2)
              : "Детали плана не переданы. Можно одобрить или отклонить."}
          </pre>
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
      )}

      {/* ── Footer: session badge + composer ── */}
      <footer className="chat-footer">
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
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Напишите сообщение…"
            disabled={loading || interruptOpen || !tid}
            className="chat-composer__input"
            aria-label="Текст сообщения"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={loading || interruptOpen || !input.trim() || !tid}
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
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}
