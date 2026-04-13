"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Analysis = {
  main_themes: string[];
  emotional_patterns: string;
  engagement: string;
  key_insights: string[];
  therapist_recommendations: string[];
  suggested_exercises: string[];
  risk_notes: string | null;
};

type ClientDetail = {
  id: string;
  email: string;
  profile: Record<string, string>;
  total_sessions: number;
  avg_duration_min: number | null;
  last_session: string | null;
  homework_total: number;
  homework_approved: number;
  top_exercises: { exercise_id: string; views: number }[];
  recent_sessions: {
    session_id: string;
    started_at: string;
    ended_at: string | null;
    exercises: string[];
  }[];
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function duration(start: string, end: string | null) {
  if (!end) return null;
  const min = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  return min > 0 ? `${min} мин` : null;
}

function AnalysisPanel({ analysis }: { analysis: Analysis }) {
  return (
    <div className="dash-analysis-panel" style={{ padding: "1.5rem", borderRadius: "var(--radius)", border: "1px solid var(--border-subtle)" }}>
      {analysis.risk_notes && (
        <div className="dash-analysis-risk" style={{ marginBottom: "1.25rem" }}>
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

export default function ClientPage() {
  const params = useParams();
  const clientId = params.clientId as string;

  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/therapist/client/${clientId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDetail(data as ClientDetail);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [clientId]);

  const loadAnalysis = async () => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const res = await fetch(`/api/therapist/analysis/${clientId}`);
      const data = (await res.json()) as { analysis?: Analysis; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setAnalysis(data.analysis!);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "Ошибка загрузки анализа");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const maxViews = detail?.top_exercises[0]?.views ?? 1;

  const PROFILE_LABELS: Record<string, string> = {
    name: "Имя",
    age: "Возраст",
    occupation: "Занятость",
    presenting_problem: "Запрос",
    diagnosis: "Диагноз",
    goals: "Цели терапии",
    notes: "Заметки",
  };

  return (
    <div className="dash-shell">
      <header className="dash-nav">
        <div className="dash-nav__brand">
          <span className="dash-nav__dot" aria-hidden="true" />
          {loading ? "Загрузка…" : detail?.email ?? "Клиент"}
        </div>
        <div className="dash-nav__actions">
          <a href="/therapist" className="mct-btn mct-btn--ghost mct-btn--sm">
            ← Дашборд
          </a>
          <a href="/" className="mct-btn mct-btn--ghost mct-btn--sm">
            Чат
          </a>
        </div>
      </header>

      <main className="dash-main">
        {loading && (
          <div className="dash-loading">
            <span className="dash-loading__dot" /><span className="dash-loading__dot" /><span className="dash-loading__dot" />
          </div>
        )}

        {error && <div className="dash-error" role="alert">{error}</div>}

        {!loading && detail && (
          <>
            {/* ── Summary cards ── */}
            <div className="dash-cards">
              <div className="dash-card">
                <span className="dash-card__value">{detail.total_sessions}</span>
                <span className="dash-card__label">Сессий</span>
              </div>
              <div className="dash-card">
                <span className="dash-card__value">
                  {detail.avg_duration_min != null ? `${Math.round(detail.avg_duration_min)} мин` : "—"}
                </span>
                <span className="dash-card__label">Ср. длительность</span>
              </div>
              <div className="dash-card">
                <span className="dash-card__value">{detail.homework_approved}/{detail.homework_total}</span>
                <span className="dash-card__label">ДЗ одобрено</span>
              </div>
              <div className="dash-card">
                <span className="dash-card__value">{fmt(detail.last_session)}</span>
                <span className="dash-card__label">Последняя сессия</span>
              </div>
            </div>

            <div className="dash-grid">
              {/* ── Profile ── */}
              {Object.keys(detail.profile).length > 0 && (
                <section className="dash-section">
                  <h2 className="dash-section__title">Профиль</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {Object.entries(detail.profile).map(([k, v]) => (
                      <div key={k} style={{ display: "flex", gap: "0.75rem", fontSize: "0.9rem" }}>
                        <span style={{ color: "var(--muted)", minWidth: "8rem", flexShrink: 0 }}>
                          {PROFILE_LABELS[k] ?? k}
                        </span>
                        <span style={{ color: "var(--text)" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Top exercises ── */}
              {detail.top_exercises.length > 0 && (
                <section className="dash-section">
                  <h2 className="dash-section__title">Популярные упражнения</h2>
                  <div className="dash-bars">
                    {detail.top_exercises.map((ex) => (
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
                </section>
              )}

              {/* ── Session history ── */}
              {detail.recent_sessions.length > 0 && (
                <section className="dash-section dash-section--wide">
                  <h2 className="dash-section__title">История сессий</h2>
                  <div className="dash-timeline">
                    {detail.recent_sessions.map((s) => (
                      <div key={s.session_id} className="dash-timeline__row">
                        <div className="dash-timeline__time">
                          <span className="dash-timeline__date">{fmt(s.started_at)}</span>
                          <span className="dash-timeline__clock">{fmtTime(s.started_at)}</span>
                        </div>
                        <div className="dash-timeline__dot" aria-hidden="true" />
                        <div className="dash-timeline__body">
                          {duration(s.started_at, s.ended_at) && (
                            <span className="dash-timeline__dur">{duration(s.started_at, s.ended_at)}</span>
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
                </section>
              )}

              {/* ── AI Analysis ── */}
              <section className="dash-section dash-section--full">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                  <h2 className="dash-section__title" style={{ margin: 0 }}>Анализ ИИ</h2>
                  {!analysis && (
                    <button
                      type="button"
                      className="dash-analysis-btn"
                      disabled={analysisLoading}
                      onClick={loadAnalysis}
                      style={{ fontSize: "0.9rem", padding: "0.5rem 1.25rem" }}
                    >
                      {analysisLoading ? "Генерирую анализ…" : "Сгенерировать анализ"}
                    </button>
                  )}
                </div>
                {analysisError && (
                  <div className="dash-error" role="alert">{analysisError}</div>
                )}
                {analysisLoading && (
                  <div className="dash-loading" style={{ justifyContent: "flex-start", gap: "0.3rem" }}>
                    <span className="dash-loading__dot" /><span className="dash-loading__dot" /><span className="dash-loading__dot" />
                  </div>
                )}
                {analysis && <AnalysisPanel analysis={analysis} />}
                {!analysis && !analysisLoading && !analysisError && (
                  <p className="dash-empty">Нажмите «Сгенерировать анализ», чтобы получить ИИ-резюме по сессиям клиента</p>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
