"use client";

import { useEffect, useState } from "react";

type Client = {
  id: string;
  email: string;
  sessions_count: number;
  pending_hw: number;
};

type HomeworkItem = {
  id: string;
  homework_ref: string;
  summary: string;
  exercise_id: string;
  weekly_sessions: string | null;
  created_at: string;
  client_email: string;
};

export default function TherapistPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [homework, setHomework] = useState<HomeworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/therapist/clients").then((r) => r.json()),
      fetch("/api/therapist/homework/all").then((r) => r.json()),
    ])
      .then(([c, h]) => {
        setClients((c as { clients: Client[] }).clients ?? []);
        setHomework((h as { homework: HomeworkItem[] }).homework ?? []);
      })
      .catch(() => setError("Ошибка загрузки данных"))
      .finally(() => setLoading(false));
  }, []);

  const handleDecision = async (id: string, approved: boolean) => {
    setActionLoading(id);
    try {
      await fetch(`/api/therapist/homework/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      });
      setHomework((prev) => prev.filter((h) => h.id !== id));
    } catch {
      setError("Ошибка при сохранении решения");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="mct-app">
        <div className="mct-login-card">
          <p>Загрузка…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mct-app">
      <header className="mct-header">
        <p className="mct-kicker">Панель терапевта</p>
        <h1 className="mct-title">Дашборд</h1>
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
          <a href="/" className="mct-btn mct-btn--ghost mct-btn--sm">
            ← Чат
          </a>
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
      </header>

      {error && (
        <p className="mct-error" role="alert">
          {error}
        </p>
      )}

      {/* Pending homework */}
      <section className="therapist-section">
        <h2 className="therapist-section-title">
          Домашние задания на проверке
          {homework.length > 0 && (
            <span className="therapist-badge">{homework.length}</span>
          )}
        </h2>

        {homework.length === 0 ? (
          <p className="therapist-empty">Нет заданий для проверки</p>
        ) : (
          <div className="therapist-cards">
            {homework.map((hw) => (
              <div key={hw.id} className="therapist-card">
                <div className="therapist-card-meta">
                  <span className="therapist-ref">{hw.homework_ref}</span>
                  <span className="therapist-client">{hw.client_email}</span>
                  <span className="therapist-date">
                    {new Date(hw.created_at).toLocaleDateString("ru-RU")}
                  </span>
                </div>
                <p className="therapist-summary">{hw.summary}</p>
                <div className="therapist-card-footer">
                  <span className="therapist-exercise">{hw.exercise_id}</span>
                  {hw.weekly_sessions && (
                    <span className="therapist-freq">{hw.weekly_sessions}</span>
                  )}
                  <div className="therapist-actions">
                    <button
                      type="button"
                      disabled={actionLoading === hw.id}
                      className="mct-btn mct-btn--primary mct-btn--sm"
                      onClick={() => handleDecision(hw.id, true)}
                    >
                      Одобрить
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading === hw.id}
                      className="mct-btn mct-btn--ghost mct-btn--sm"
                      onClick={() => handleDecision(hw.id, false)}
                    >
                      Отклонить
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Clients list */}
      <section className="therapist-section">
        <h2 className="therapist-section-title">Клиенты</h2>

        {clients.length === 0 ? (
          <p className="therapist-empty">Клиенты не прикреплены</p>
        ) : (
          <table className="therapist-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Сессий</th>
                <th>ДЗ на проверке</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>{c.email}</td>
                  <td>{c.sessions_count}</td>
                  <td>
                    {c.pending_hw > 0 ? (
                      <span className="therapist-badge">{c.pending_hw}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
