"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseApiJson } from "@/src/lib/parse-api-response";

type UserInfo = { id: string; email: string; role: string };

type Msg = { role: "user" | "assistant"; text: string };

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

  const scrollDown = () =>
    endRef.current?.scrollIntoView({ behavior: "smooth" });

  // Восстанавливаем модальность, threadId и историю из localStorage/checkpointer'а
  useEffect(() => {
    const savedModality = (localStorage.getItem("mct_modality") as "mct" | "act") ?? "mct";
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

  const startNewChat = useCallback((mod: "mct" | "act" = modality) => {
    const newTid = crypto.randomUUID();
    localStorage.setItem(`mct_thread_id_${mod}`, newTid);
    setTid(newTid);
    setMessages([]);
    setError(null);
    setInterruptOpen(false);
    setInterruptPayload(null);
  }, [modality]);

  const switchModality = useCallback((mod: "mct" | "act") => {
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
  }, [modality]);

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
  }, [input, loading, tid]);

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

  return (
    <div className="mct-app">
      <header className="mct-header">
        {user && (
          <div className="mct-user-bar">
            <span className="mct-user-email">{user.email}</span>
            {(user.role === "therapist" || user.role === "admin") && (
              <a href="/therapist" className="mct-btn mct-btn--ghost mct-btn--sm">
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
          </div>
        )}
        <p className="mct-kicker">Образовательный ассистент</p>
        <h1 className="mct-title">Консультант по темам МКТ</h1>
        <p className="mct-lead">
          Справочник метакогнитивной терапии, каталог упражнений, фильтры
          безопасности и сценарий домашнего задания с подтверждением. Работает на
          LangGraph и Claude.
        </p>
        <div className="mct-modality-row">
          <div className="mct-modality-toggle" role="group" aria-label="Выбор подхода">
            <button
              type="button"
              className={`mct-modality-btn${modality === "mct" ? " mct-modality-btn--active" : ""}`}
              onClick={() => switchModality("mct")}
              disabled={loading}
            >
              МКТ
            </button>
            <button
              type="button"
              className={`mct-modality-btn${modality === "act" ? " mct-modality-btn--active" : ""}`}
              onClick={() => switchModality("act")}
              disabled={loading}
            >
              ACT
            </button>
          </div>
          <div className="mct-thread-row">
            <p className="mct-thread" title={tid ?? undefined}>
              <span>Сессия</span>
              <code>
                {tid ? `${tid.slice(0, 8)}…${tid.slice(-4)}` : "…"}
              </code>
            </p>
            <button
              type="button"
              className="mct-btn mct-btn--ghost mct-btn--sm"
              onClick={() => startNewChat()}
              disabled={loading}
            >
              Новый чат
            </button>
          </div>
        </div>
      </header>

      <div
        className={`thinking-shell mct-chat${loading ? " thinking-shell--active" : ""}`}
      >
        <div
          className={`thinking-bar${loading ? " thinking-bar--visible" : ""}`}
          aria-hidden="true"
        />
        <div className="mct-chat-scroll">
          {messages.length === 0 && (
            <div className="mct-empty">
              <p className="mct-empty-title">С чего начать</p>
              <ul>
                <li>«Найди упражнения по руминации и кратко опиши одно»</li>
                <li>
                  «Чем беспокойство отличается от полезного решения задач?»
                </li>
                <li>
                  После выбора упражнения: «Предложи домашний план на базе
                  ATT-01» — появится запрос на подтверждение
                </li>
              </ul>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`mct-msg${msg.role === "user" ? " mct-msg--user" : " mct-msg--assistant"}`}
            >
              <span className="mct-msg-meta">
                {msg.role === "user" ? "Вы" : "Ответ"}
              </span>
              <div className="mct-bubble">{msg.text}</div>
            </div>
          ))}
          {loading && (
            <div className="thinking-panel" role="status" aria-live="polite">
              <span className="thinking-label">Печатает ответ</span>
              <span className="thinking-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          )}
          <div ref={endRef} className="mct-scroll-anchor" />
        </div>
      </div>

      {interruptOpen && (
        <section className="mct-interrupt" aria-labelledby="hw-confirm-title">
          <h2 id="hw-confirm-title">Подтверждение домашнего плана</h2>
          <pre>
            {interruptPayload != null
              ? JSON.stringify(interruptPayload, null, 2)
              : "Детали плана не переданы. Можно одобрить или отклонить."}
          </pre>
          <div className="mct-interrupt-actions">
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

      {error && (
        <p className="mct-error" role="alert">
          {error}
        </p>
      )}

      <div className="mct-composer">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Напишите сообщение…"
          disabled={loading || interruptOpen || !tid}
          className="mct-input"
          aria-label="Текст сообщения"
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={loading || interruptOpen || !input.trim() || !tid}
          className="mct-btn mct-btn--primary"
        >
          {loading ? "…" : "Отправить"}
        </button>
      </div>
    </div>
  );
}
