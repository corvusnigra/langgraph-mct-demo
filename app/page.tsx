"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

type Msg = { role: "user" | "assistant"; text: string };

export default function ChatPage() {
  const [tid] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Показывать панель «Одобрить / Отклонить» (не только при непустом payload с сервера). */
  const [interruptOpen, setInterruptOpen] = useState(false);
  const [interruptPayload, setInterruptPayload] = useState<unknown>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const scrollDown = () => endRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => {
    if (loading) scrollDown();
  }, [loading]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
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
      scrollDown();
    }
  }, [input, loading, tid]);

  const resume = useCallback(
    async (value: string) => {
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
        scrollDown();
      }
    },
    [tid]
  );

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px 48px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 600, margin: "0 0 8px" }}>
          Консультант МКТ (LangGraph + Claude)
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
          Полный граф: справочник МКТ, каталог упражнений, guardrails, домашний план с
          подтверждением. Thread:{" "}
          <code style={{ fontSize: "0.8rem" }}>{tid.slice(0, 13)}…</code>
        </p>
      </header>

      <div
        className={`thinking-shell${loading ? " thinking-shell--active" : ""}`}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--surface)",
          minHeight: 320,
          padding: 16,
          marginBottom: 16,
          overflow: "auto",
          maxHeight: "min(60vh, 520px)",
        }}
      >
        <div
          className={`thinking-bar${loading ? " thinking-bar--visible" : ""}`}
          aria-hidden="true"
        />
        {messages.length === 0 && (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Пример: «Найди упражнения по руминации», затем «Предложи домашнее
            задание на базе ATT-01 для меня» (имя и email можно дать в чате) —
            появится запрос подтверждения плана.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              marginBottom: 14,
              whiteSpace: "pre-wrap",
              lineHeight: 1.5,
            }}
          >
            <span
              style={{
                color: msg.role === "user" ? "var(--accent)" : "var(--muted)",
                fontSize: "0.75rem",
                textTransform: "uppercase",
              }}
            >
              {msg.role === "user" ? "Вы" : "Агент"}
            </span>
            <div style={{ marginTop: 4 }}>{msg.text}</div>
          </div>
        ))}
        {loading && (
          <div className="thinking-panel" role="status" aria-live="polite">
            <span className="thinking-label">Агент думает</span>
            <span className="thinking-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {interruptOpen && (
        <div
          style={{
            border: "1px solid var(--accent)",
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
            background: "rgba(59, 130, 246, 0.08)",
          }}
        >
          <strong>Подтверждение домашнего плана</strong>
          <pre
            style={{
              margin: "12px 0",
              fontSize: "0.8rem",
              overflow: "auto",
              maxHeight: 200,
            }}
          >
            {interruptPayload != null
              ? JSON.stringify(interruptPayload, null, 2)
              : "Детали плана не переданы (пустой payload). Всё равно можно одобрить или отклонить."}
          </pre>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={loading}
              onClick={() => resume("approved")}
              style={btnStyle(true)}
            >
              Одобрить
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => resume("rejected")}
              style={btnStyle(false)}
            >
              Отклонить
            </button>
          </div>
        </div>
      )}

      {error && (
        <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Сообщение…"
          disabled={loading || interruptOpen}
          style={{
            flex: 1,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: "1rem",
          }}
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={loading || interruptOpen || !input.trim()}
          style={btnStyle(true)}
        >
          {loading ? "…" : "Отправить"}
        </button>
      </div>
    </div>
  );
}

function btnStyle(primary: boolean): CSSProperties {
  return {
    padding: "12px 18px",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "0.95rem",
    background: primary ? "var(--accent)" : "var(--border)",
    color: primary ? "#fff" : "var(--text)",
  };
}
