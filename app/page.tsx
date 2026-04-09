"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const endRef = useRef<HTMLDivElement>(null);

  const scrollDown = () =>
    endRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => {
    setTid(crypto.randomUUID());
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
        body: JSON.stringify({ threadId: tid, message: text }),
      });
      const data = (await res.json()) as {
        reply?: string;
        interrupted?: boolean;
        interruptPayload?: unknown;
        error?: string;
      };
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
        const data = (await res.json()) as { reply?: string; error?: string };
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
        <p className="mct-kicker">Образовательный ассистент</p>
        <h1 className="mct-title">Консультант по темам МКТ</h1>
        <p className="mct-lead">
          Справочник метакогнитивной терапии, каталог упражнений, фильтры
          безопасности и сценарий домашнего задания с подтверждением. Работает на
          LangGraph и Claude.
        </p>
        <p className="mct-thread" title={tid ?? undefined}>
          <span>Сессия</span>
          <code>
            {tid ? `${tid.slice(0, 8)}…${tid.slice(-4)}` : "…"}
          </code>
        </p>
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
