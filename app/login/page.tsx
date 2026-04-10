"use client";

import { useState } from "react";

type State = "idle" | "loading" | "sent" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setErrorMsg(data.error ?? "Ошибка сервера");
        setState("error");
        return;
      }
      setState("sent");
    } catch {
      setErrorMsg("Ошибка сети");
      setState("error");
    }
  };

  if (state === "sent") {
    return (
      <div className="mct-app">
        <div className="mct-login-card">
          <h1 className="mct-title">Письмо отправлено</h1>
          <p>
            Проверьте <strong>{email}</strong> и перейдите по ссылке для входа.
          </p>
          <button
            type="button"
            className="mct-btn mct-btn--ghost"
            onClick={() => setState("idle")}
          >
            Попробовать другой адрес
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mct-app">
      <div className="mct-login-card">
        <p className="mct-kicker">Образовательный ассистент</p>
        <h1 className="mct-title">Консультант по темам МКТ</h1>
        <p className="mct-lead">Введите email — мы отправим ссылку для входа.</p>

        <form onSubmit={handleSubmit} className="mct-login-form">
          <label htmlFor="email" className="mct-login-label">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={state === "loading"}
            className="mct-input"
          />
          <button
            type="submit"
            disabled={state === "loading" || !email.trim()}
            className="mct-btn mct-btn--primary"
          >
            {state === "loading" ? "Отправка…" : "Получить ссылку"}
          </button>
        </form>

        {state === "error" && (
          <p className="mct-error" role="alert">
            {errorMsg}
          </p>
        )}
      </div>
    </div>
  );
}
