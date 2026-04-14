"use client";

import { useState } from "react";

type State = "idle" | "loading" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setErrorMsg(data.error ?? "Ошибка входа");
        setState("error");
        return;
      }
      window.location.href = "/";
    } catch {
      setErrorMsg("Ошибка сети");
      setState("error");
    }
  };

  return (
    <div className="mct-app">
      <div className="mct-login-card">
        <p className="mct-kicker">Образовательный ассистент</p>
        <h1 className="mct-title">Консультант по темам МКТ</h1>
        <p className="mct-lead">Введите email и пароль для входа.</p>

        <form onSubmit={handleSubmit} className="mct-login-form">
          <label htmlFor="email" className="mct-login-label">Email</label>
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

          <label htmlFor="password" className="mct-login-label" style={{ marginTop: "0.75rem" }}>
            Пароль
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Минимум 6 символов"
            disabled={state === "loading"}
            className="mct-input"
          />

          <button
            type="submit"
            disabled={state === "loading" || !email.trim() || !password.trim()}
            className="mct-btn mct-btn--primary"
            style={{ marginTop: "1rem" }}
          >
            {state === "loading" ? "Вход…" : "Войти"}
          </button>
        </form>

        <p style={{ marginTop: "0.75rem", fontSize: "0.8rem", opacity: 0.5, textAlign: "center" }}>
          Нет аккаунта — он создастся автоматически при первом входе.
        </p>

        {state === "error" && (
          <p className="mct-error" role="alert">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
