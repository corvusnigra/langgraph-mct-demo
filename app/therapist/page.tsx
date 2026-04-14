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

type ClientAnalytics = {
  id: string;
  email: string;
  total_sessions: number;
  avg_duration_min: number | null;
  last_session: string | null;
  unique_exercises: number;
  homework_total: number;
  homework_approved: number;
};

type ExerciseStat = { exercise_id: string; views: number };

type RecentSession = {
  session_id: string;
  client_email: string;
  started_at: string;
  ended_at: string | null;
  exercises: string[];
};

type Analytics = {
  clients: ClientAnalytics[];
  top_exercises: ExerciseStat[];
  recent_sessions: RecentSession[];
  total_sessions_week: number;
};

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function duration(start: string, end: string | null) {
  if (!end) return null;
  const min = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  return min > 0 ? `${min} мин` : null;
}

export default function TherapistPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [homework, setHomework] = useState<HomeworkItem[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"analytics" | "homework" | "clients">("analytics");
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { user?: { role: string } } | null) => setUserRole(data?.user?.role ?? null))
      .catch(() => null);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/therapist/clients").then((r) => r.json()),
      fetch("/api/therapist/homework/all").then((r) => r.json()),
      fetch("/api/therapist/analytics").then((r) => r.json()),
    ])
      .then(([c, h, a]) => {
        setClients((c as { clients: Client[] }).clients ?? []);
        setHomework((h as { homework: HomeworkItem[] }).homework ?? []);
        setAnalytics(a as Analytics);
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

  const maxViews = analytics?.top_exercises[0]?.views ?? 1;

  return (
    <div className="dash-shell">
      {/* ── Nav ── */}
      <header className="dash-nav">
        <div className="dash-nav__brand">
          <span className="dash-nav__dot" aria-hidden="true" />
          Дашборд терапевта
        </div>
        <nav className="dash-tabs" aria-label="Разделы">
          {(
            [
              { key: "analytics", label: "Аналитика" },
              { key: "homework", label: `Задания${homework.length ? ` · ${homework.length}` : ""}` },
              { key: "clients", label: "Клиенты" },
            ] as { key: typeof tab; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`dash-tab${tab === key ? " dash-tab--active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="dash-nav__actions">
          {userRole === "admin" && (
            <a href="/admin/knowledge" className="mct-btn mct-btn--ghost mct-btn--sm">
              База знаний
            </a>
          )}
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

      {/* ── Content ── */}
      <main className="dash-main">
        {loading && (
          <div className="dash-loading">
            <span className="dash-loading__dot" /><span className="dash-loading__dot" /><span className="dash-loading__dot" />
          </div>
        )}

        {error && (
          <div className="dash-error" role="alert">{error}</div>
        )}

        {/* ── Analytics tab ── */}
        {!loading && tab === "analytics" && analytics && (
          <>
            {/* Summary cards */}
            <div className="dash-cards">
              <div className="dash-card">
                <span className="dash-card__value">{analytics.clients.length}</span>
                <span className="dash-card__label">Клиентов</span>
                <svg className="dash-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "absolute", right: "1.5rem", bottom: "1.5rem", width: "24px", opacity: 0.1 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div className="dash-card">
                <span className="dash-card__value">{analytics.total_sessions_week}</span>
                <span className="dash-card__label">Сессий за 7 дней</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "absolute", right: "1.5rem", bottom: "1.5rem", width: "24px", opacity: 0.1 }}><path d="M12 2v20"/><path d="m4.93 4.93 14.14 14.14"/><path d="M2 12h20"/><path d="m19.07 4.93-14.14 14.14"/></svg>
              </div>
              <div className="dash-card">
                <span className="dash-card__value">{homework.length}</span>
                <span className="dash-card__label">Заданий на проверке</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "absolute", right: "1.5rem", bottom: "1.5rem", width: "24px", opacity: 0.1 }}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              </div>
              <div className="dash-card">
                <span className="dash-card__value">{analytics.top_exercises.length}</span>
                <span className="dash-card__label">Упражнений в каталоге</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "absolute", right: "1.5rem", bottom: "1.5rem", width: "24px", opacity: 0.1 }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              </div>
            </div>

            <div className="dash-grid">
              {/* Recent sessions */}
              <section className="dash-section dash-section--wide">
                <h2 className="dash-section__title">Последние сессии</h2>
                {analytics.recent_sessions.length === 0 ? (
                  <div className="dash-empty">
                    <svg className="dash-empty__icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p>Сессий пока нет. Как только клиенты начнут общаться с ботом, они появятся здесь.</p>
                  </div>
                ) : (
                  <div className="dash-timeline">
                    {analytics.recent_sessions.map((s) => (
                      <div key={s.session_id} className="dash-timeline__row">
                        <div className="dash-timeline__time">
                          <span className="dash-timeline__date">{fmt(s.started_at)}</span>
                          <span className="dash-timeline__clock">{fmtTime(s.started_at)}</span>
                        </div>
                        <div className="dash-timeline__dot" aria-hidden="true" />
                        <div className="dash-timeline__body">
                          <span className="dash-timeline__email">{s.client_email}</span>
                          {duration(s.started_at, s.ended_at) && (
                            <span className="dash-timeline__dur">
                              {duration(s.started_at, s.ended_at)}
                            </span>
                          )}
                          {s.exercises.length > 0 && (
                            <div className="dash-timeline__exercises">
                              {s.exercises.map((ex) => (
                                <span key={ex} className="dash-tag">{ex}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Top exercises */}
              <section className="dash-section">
                <h2 className="dash-section__title">Популярные упражнения</h2>
                {analytics.top_exercises.length === 0 ? (
                  <div className="dash-empty">
                    <svg className="dash-empty__icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <p>Нет данных о просмотрах упражнений.</p>
                  </div>
                ) : (
                  <div className="dash-bars">
                    {analytics.top_exercises.map((ex) => (
                      <div key={ex.exercise_id} className="dash-bar">
                        <div className="dash-bar__label">
                          <span className="dash-bar__id">{ex.exercise_id}</span>
                          <span className="dash-bar__count">{ex.views}</span>
                        </div>
                        <div className="dash-bar__track">
                          <div
                            className="dash-bar__fill"
                            style={{ width: `${Math.round((ex.views / maxViews) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Per-client stats */}
              <section className="dash-section dash-section--full">
                <h2 className="dash-section__title">Статистика по клиентам</h2>
                {analytics.clients.length === 0 ? (
                  <div className="dash-empty">
                    <svg className="dash-empty__icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <p>У вас пока нет прикреплённых клиентов.</p>
                  </div>
                ) : (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Сессий</th>
                          <th>Ср. длительность</th>
                          <th>Упражнений</th>
                          <th>ДЗ</th>
                          <th>Одобрено</th>
                          <th>Последняя сессия</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.clients.map((c) => (
                          <tr key={c.id}>
                            <td className="dash-table__email">{c.email}</td>
                            <td>{c.total_sessions}</td>
                            <td>
                              {c.avg_duration_min != null
                                ? `${Math.round(c.avg_duration_min)} мин`
                                : "—"}
                            </td>
                            <td>{c.unique_exercises}</td>
                            <td>{c.homework_total}</td>
                            <td>
                              {c.homework_total > 0 ? (
                                <span className={`dash-pill${c.homework_approved === c.homework_total ? " dash-pill--ok" : ""}`}>
                                  {c.homework_approved}/{c.homework_total}
                                </span>
                              ) : "—"}
                            </td>
                            <td className="dash-table__muted">{fmt(c.last_session)}</td>
                            <td>
                              <a
                                href={`/therapist/client/${c.id}`}
                                className="dash-analysis-btn"
                                style={{ textDecoration: "none", display: "inline-block" }}
                              >
                                Подробнее →
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </>
        )}

        {/* ── Homework tab ── */}
        {!loading && tab === "homework" && (
          <section className="dash-section dash-section--full">
            <h2 className="dash-section__title">
              Домашние задания на проверке
              {homework.length > 0 && (
                <span className="dash-badge">{homework.length}</span>
              )}
            </h2>
            {homework.length === 0 ? (
              <div className="dash-empty">
                <svg className="dash-empty__icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 00-2-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p>Все задания проверены. Клиентам нечего ждать!</p>
              </div>
            ) : (
              <div className="dash-hw-list">
                {homework.map((hw) => (
                  <div key={hw.id} className="dash-hw-card">
                    <div className="dash-hw-card__head">
                      <code className="dash-hw-card__ref">{hw.homework_ref}</code>
                      <span className="dash-hw-card__email">{hw.client_email}</span>
                      <span className="dash-hw-card__date">{fmt(hw.created_at)}</span>
                    </div>
                    <p className="dash-hw-card__summary">{hw.summary}</p>
                    <div className="dash-hw-card__foot">
                      <span className="dash-tag">{hw.exercise_id}</span>
                      {hw.weekly_sessions && (
                        <span className="dash-hw-card__freq">{hw.weekly_sessions}</span>
                      )}
                      <div className="dash-hw-card__actions">
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
        )}

        {/* ── Clients tab ── */}
        {!loading && tab === "clients" && (
          <section className="dash-section dash-section--full">
            <h2 className="dash-section__title">Клиенты</h2>
            {clients.length === 0 ? (
              <p className="dash-empty">Клиенты не прикреплены</p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Сессий</th>
                      <th>ДЗ на проверке</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c) => (
                      <tr key={c.id}>
                        <td className="dash-table__email">
                          <a href={`/therapist/client/${c.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                            {c.email}
                          </a>
                        </td>
                        <td>{c.sessions_count}</td>
                        <td>
                          {c.pending_hw > 0 ? (
                            <span className="dash-badge">{c.pending_hw}</span>
                          ) : "—"}
                        </td>
                        <td>
                          <a
                            href={`/therapist/client/${c.id}`}
                            className="dash-analysis-btn"
                            style={{ textDecoration: "none", display: "inline-block" }}
                          >
                            Подробнее →
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
