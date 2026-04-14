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
    <div className="mct-app" style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "radial-gradient(ellipse at 60% 20%, #0f1520 0%, #0c0f14 70%)",
      backgroundImage: "radial-gradient(ellipse at 60% 20%, #0f1520 0%, #0c0f14 70%), radial-gradient(circle, rgba(91,159,212,0.04) 1px, transparent 1px)",
      backgroundSize: "100% 100%, 28px 28px",
    }}>
      <div className="mct-login-card">
        {/* SVG логотип — нейронная сеть */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "0.25rem" }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <circle cx="24" cy="8" r="3.5" fill="#5b9fd4" opacity="0.9"/>
            <circle cx="8" cy="32" r="3.5" fill="#5b9fd4" opacity="0.7"/>
            <circle cx="40" cy="32" r="3.5" fill="#4db8a0" opacity="0.7"/>
            <circle cx="24" cy="42" r="3.5" fill="#5b9fd4" opacity="0.5"/>
            <line x1="24" y1="11.5" x2="8" y2="28.5" stroke="#5b9fd4" strokeWidth="1" strokeOpacity="0.4"/>
            <line x1="24" y1="11.5" x2="40" y2="28.5" stroke="#4db8a0" strokeWidth="1" strokeOpacity="0.4"/>
            <line x1="8" y1="35.5" x2="24" y2="38.5" stroke="#5b9fd4" strokeWidth="1" strokeOpacity="0.3"/>
            <line x1="40" y1="35.5" x2="24" y2="38.5" stroke="#4db8a0" strokeWidth="1" strokeOpacity="0.3"/>
            <line x1="8" y1="32" x2="40" y2="32" stroke="#5b9fd4" strokeWidth="1" strokeOpacity="0.2"/>
            <circle cx="24" cy="8" r="5.5" stroke="#5b9fd4" strokeWidth="0.75" strokeOpacity="0.3" fill="none"/>
          </svg>
        </div>
        <p className="mct-kicker" style={{ textAlign: "center", fontSize: "0.75rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", margin: 0 }}>Образовательный ассистент</p>
        <h1 className="mct-title" style={{ textAlign: "center", fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.02em", margin: "0.25rem 0 0" }}>МКТ &amp; ACT Консультант</h1>
        <p className="mct-lead" style={{ textAlign: "center", color: "var(--text-secondary)", fontSize: "0.875rem", margin: 0 }}>Введите email и пароль для входа.</p>

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
