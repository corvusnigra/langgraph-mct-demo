"use client";

import { useEffect, useState } from "react";

type Analysis = {
  main_themes: string[];
  emotional_patterns: string;
  engagement: string;
  key_insights: string[];
  therapist_recommendations: string[];
  suggested_exercises: string[];
  risk_notes: string | null;
};

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

function fmt(d: string | null) {
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

function AnalysisPanel({ analysis }: { analysis: Analysis }) {
  return (
    <div className="dash-analysis-panel">
      {analysis.risk_notes && (
        <div className="dash-analysis-risk">
          <span className="dash-analysis-risk__icon">⚠</span>
          <span>{analysis.risk_notes}</span>
        </div>
      )}
      <div className="dash-analysis-grid">
        <div className="dash-analysis-block">
          <h4 className="dash-analysis-block__title">Основные темы</h4>
          <ul className="dash-analysis-list">
            {analysis.main_themes.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
        <div className="dash-analysis-block">
          <h4 className="dash-analysis-block__title">Эмоциональные паттерны</h4>
          <p className="dash-analysis-text">{analysis.emotional_patterns}</p>
        </div>
        <div className="dash-analysis-block">
          <h4 className="dash-analysis-block__title">Вовлечённость в практики</h4>
          <p className="dash-analysis-text">{analysis.engagement}</p>
        </div>
        <div className="dash-analysis-block">
          <h4 className="dash-analysis-block__title">Ключевые наблюдения</h4>
          <ul className="dash-analysis-list">
            {analysis.key_insights.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
        <div className="dash-analysis-block dash-analysis-block--accent">
          <h4 className="dash-analysis-block__title">Рекомендации терапевту</h4>
          <ul className="dash-analysis-list">
            {analysis.therapist_recommendations.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
        <div className="dash-analysis-block">
          <h4 className="dash-analysis-block__title">Предлагаемые упражнения</h4>
          <div className="dash-analysis-tags">
            {analysis.suggested_exercises.map((e, i) => (
              <span key={i} className="dash-tag">{e}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TherapistPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [homework, setHomework] = useState<HomeworkItem[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"analytics" | "homework" | "clients">("analytics");
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [analysisLoading, setAnalysisLoading] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [openAnalysis, setOpenAnalysis] = useState<string | null>(null);

  const fetchAnalysis = async (clientId: string) => {
    if (analyses[clientId]) { setOpenAnalysis(clientId); return; }
    setAnalysisLoading(clientId);
    setAnalysisError(null);
    try {
      const res = await fetch(`/api/therapist/analysis/${clientId}`);
      const data = (await res.json()) as { analysis?: Analysis; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setAnalyses((prev) => ({ ...prev, [clientId]: data.analysis! }));
      setOpenAnalysis(clientId);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "Ошибка загрузки анализа");
    } finally {
      setAnalysisLoading(null);
    }
  };

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
              </div>
              <div className="dash-card">
                <span className="dash-card__value">{analytics.total_sessions_week}</span>
                <span className="dash-card__label">Сессий за 7 дней</span>
              </div>
              <div className="dash-card">
                <span className="dash-card__value">{homework.length}</span>
                <span className="dash-card__label">Заданий на проверке</span>
              </div>
              <div className="dash-card">
                <span className="dash-card__value">{analytics.top_exercises.length}</span>
                <span className="dash-card__label">Упражнений просмотрено</span>
              </div>
            </div>

            <div className="dash-grid">
              {/* Recent sessions */}
              <section className="dash-section dash-section--wide">
                <h2 className="dash-section__title">Последние сессии</h2>
                {analytics.recent_sessions.length === 0 ? (
                  <p className="dash-empty">Сессий пока нет</p>
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
                  <p className="dash-empty">Нет данных</p>
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
                  <p className="dash-empty">Клиенты не прикреплены</p>
                ) : (
                  <>
                  {analysisError && (
                    <div className="dash-error" role="alert" style={{ marginBottom: "1rem" }}>{analysisError}</div>
                  )}
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
                          <>
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
                                <button
                                  type="button"
                                  className="dash-analysis-btn"
                                  disabled={analysisLoading === c.id}
                                  onClick={() => openAnalysis === c.id ? setOpenAnalysis(null) : fetchAnalysis(c.id)}
                                >
                                  {analysisLoading === c.id ? "…" : openAnalysis === c.id ? "Скрыть" : "Анализ ИИ"}
                                </button>
                              </td>
                            </tr>
                            {openAnalysis === c.id && analyses[c.id] && (
                              <tr key={`${c.id}-analysis`} className="dash-analysis-row">
                                <td colSpan={8}>
                                  <AnalysisPanel analysis={analyses[c.id]} />
                                </td>
                              </tr>
                            )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
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
              <p className="dash-empty">Нет заданий для проверки</p>
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
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c) => (
                      <tr key={c.id}>
                        <td className="dash-table__email">{c.email}</td>
                        <td>{c.sessions_count}</td>
                        <td>
                          {c.pending_hw > 0 ? (
                            <span className="dash-badge">{c.pending_hw}</span>
                          ) : "—"}
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
