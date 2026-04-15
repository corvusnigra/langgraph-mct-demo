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
  act_hexaflex?: {
    acceptance: number;
    defusion: number;
    present_moment: number;
    self_as_context: number;
    values: number;
    committed_action: number;
  };
  mct_profile?: {
    detached_mindfulness: number;
    attentional_flexibility: number;
    metacognitive_awareness: number;
    rumination_control: number;
    adaptive_strategies: number;
    emotional_regulation: number;
  };
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

// ── SVG Charts ──────────────────────────────────────────────────────────────

function DonutChart({ value, max, label, color = "var(--accent)" }: {
  value: number; max: number; label: string; color?: string;
}) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const dash = pct * circ;
  return (
    <div style={{ textAlign: "center", flex: "0 0 auto" }}>
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r={r} fill="none" stroke="var(--border-subtle)" strokeWidth="7" />
        {max > 0 && (
          <circle cx="45" cy="45" r={r} fill="none" stroke={color} strokeWidth="7"
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
            transform="rotate(-90 45 45)"
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
        )}
        <text x="45" y="41" textAnchor="middle" fontSize="15" fontWeight="700" fill="currentColor">
          {max > 0 ? `${Math.round(pct * 100)}%` : "—"}
        </text>
        <text x="45" y="57" textAnchor="middle" fontSize="10" fill="var(--muted)">
          {value}/{max}
        </text>
      </svg>
      <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>{label}</p>
    </div>
  );
}

function SessionActivityChart({ sessions }: {
  sessions: Array<{ started_at: string }>;
}) {
  const DAYS = 28;
  const today = new Date();
  const counts = new Map<string, number>();
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    counts.set(d.toISOString().slice(0, 10), 0);
  }
  for (const s of sessions) {
    const key = s.started_at.slice(0, 10);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entries = [...counts.entries()].reverse();
  const maxC = Math.max(1, ...entries.map(([, v]) => v));
  const barW = 14, gap = 4, H = 50;
  const totalW = DAYS * (barW + gap) - gap;
  return (
    <svg width="100%" viewBox={`0 0 ${totalW} ${H + 18}`} preserveAspectRatio="none">
      {entries.map(([date, count], i) => {
        const bH = count > 0 ? Math.max(5, (count / maxC) * H) : 3;
        const x = i * (barW + gap);
        const y = H - bH;
        const d = new Date(date + "T00:00:00");
        return (
          <g key={date}>
            <rect x={x} y={y} width={barW} height={bH} rx={3}
              fill={count > 0 ? "var(--accent)" : "var(--border-subtle)"}
              opacity={count > 0 ? 0.85 : 0.35}
            />
            {i % 7 === 0 && (
              <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize="8" fill="var(--muted)">
                {`${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function DurationChart({ sessions }: {
  sessions: Array<{ started_at: string; ended_at: string | null }>;
}) {
  const pts = sessions
    .filter((s) => s.ended_at)
    .map((s) => ({
      min: Math.round((new Date(s.ended_at!).getTime() - new Date(s.started_at).getTime()) / 60000),
      label: new Date(s.started_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
    }))
    .filter((s) => s.min > 0 && s.min < 300)
    .reverse()
    .slice(-12);

  if (pts.length < 2) return <p style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Недостаточно данных</p>;

  const maxMin = Math.max(...pts.map((p) => p.min));
  const W = 320, H = 60;
  const step = W / (pts.length - 1);
  const points = pts.map((p, i) => ({ x: i * step, y: H - (p.min / maxMin) * H, ...p }));
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${points[points.length - 1].x},${H} L0,${H}Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="dur-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#dur-g)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill="var(--accent)" />
          {(i === 0 || i === pts.length - 1 || pts.length <= 6) && (
            <text x={p.x} y={H + 14} textAnchor="middle" fontSize="8" fill="var(--muted)">
              {p.min}м
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function RadarChart({ values }: { values: { label: string; value: number; max: number }[] }) {
  const cx = 100, cy = 100, r = 75;
  const n = values.length;
  const angle = (i: number) => (i * 2 * Math.PI) / n - Math.PI / 2;

  const gridLevels = [0.25, 0.5, 0.75, 1];
  const axisPoints = values.map((_, i) => ({
    x: cx + r * Math.cos(angle(i)),
    y: cy + r * Math.sin(angle(i)),
  }));

  const dataPoints = values.map((v, i) => {
    const ratio = v.max > 0 ? Math.min(v.value / v.max, 1) : 0;
    return {
      x: cx + r * ratio * Math.cos(angle(i)),
      y: cy + r * ratio * Math.sin(angle(i)),
    };
  });

  const dataPath = dataPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + "Z";

  return (
    <svg width="200" height="200" viewBox="0 0 200 200" style={{ overflow: "visible" }}>
      {/* Grid levels */}
      {gridLevels.map((lvl) => {
        const pts = values.map((_, i) => {
          const x = cx + r * lvl * Math.cos(angle(i));
          const y = cy + r * lvl * Math.sin(angle(i));
          return `${i === 0 ? "M" : "L"}${x},${y}`;
        }).join(" ") + "Z";
        return <path key={lvl} d={pts} fill="none" stroke="var(--border-subtle)" strokeWidth="1" />;
      })}
      {/* Axes */}
      {axisPoints.map((pt, i) => (
        <line key={i} x1={cx} y1={cy} x2={pt.x} y2={pt.y}
          stroke="var(--border-subtle)" strokeWidth="1" />
      ))}
      {/* Data area */}
      <path d={dataPath} fill="var(--accent)" fillOpacity="0.2" stroke="var(--accent)" strokeWidth="2" />
      {/* Data points */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill="var(--accent)" />
      ))}
      {/* Labels */}
      {values.map((v, i) => {
        const lx = cx + (r + 18) * Math.cos(angle(i));
        const ly = cy + (r + 18) * Math.sin(angle(i));
        return (
          <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
            fontSize="9" fill="var(--muted)" style={{ fontWeight: 500 }}>
            {v.label}
          </text>
        );
      })}
    </svg>
  );
}

function RiskMeter({ riskNotes }: { riskNotes: string | null }) {
  const hasRisk = !!riskNotes;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
      <svg width="90" height="90" viewBox="0 0 90 90">
        {/* Background arc */}
        <path d="M15,65 A38,38 0 0,1 75,65" fill="none" stroke="var(--border-subtle)" strokeWidth="7" strokeLinecap="round" />
        {/* Color arc */}
        <path d="M15,65 A38,38 0 0,1 75,65" fill="none"
          stroke={hasRisk ? "#ef4444" : "#10b981"}
          strokeWidth="7" strokeLinecap="round"
          strokeDasharray={hasRisk ? "119 0" : "60 59"}
        />
        {/* Icon */}
        <text x="45" y="58" textAnchor="middle" fontSize="22">
          {hasRisk ? "⚠" : "✓"}
        </text>
      </svg>
      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)", textAlign: "center" }}>
        {hasRisk ? "Есть риски" : "Рисков нет"}
      </p>
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.2rem" }}>
        <span style={{ color: "var(--muted)" }}>{label}</span>
        <span style={{ fontWeight: 600 }}>{value}/10</span>
      </div>
      <div style={{ height: "4px", background: "var(--border-subtle)", borderRadius: "2px" }}>
        <div style={{ height: "100%", borderRadius: "2px", background: color,
          width: `${(value / 10) * 100}%`, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

function AnalysisPanel({ analysis }: { analysis: Analysis }) {
  const hx = analysis.act_hexaflex;
  const mct = analysis.mct_profile;

  const actValues = hx ? [
    { label: "Принятие", value: hx.acceptance, max: 10 },
    { label: "Расцепление", value: hx.defusion, max: 10 },
    { label: "Настоящее", value: hx.present_moment, max: 10 },
    { label: "Я-контекст", value: hx.self_as_context, max: 10 },
    { label: "Ценности", value: hx.values, max: 10 },
    { label: "Действие", value: hx.committed_action, max: 10 },
  ] : null;

  const mctValues = mct ? [
    { label: "Детач. осознанность", value: mct.detached_mindfulness, max: 10 },
    { label: "Гибкость внимания", value: mct.attentional_flexibility, max: 10 },
    { label: "Мета-осознанность", value: mct.metacognitive_awareness, max: 10 },
    { label: "Контроль руминации", value: mct.rumination_control, max: 10 },
    { label: "Адапт. стратегии", value: mct.adaptive_strategies, max: 10 },
    { label: "Эмоц. регуляция", value: mct.emotional_regulation, max: 10 },
  ] : null;

  const ACT_COLOR = "var(--accent)";
  const MCT_COLOR = "#10b981";

  return (
    <div className="dash-analysis-panel">
      {/* Radars row */}
      {(actValues || mctValues) && (
        <div style={{ display: "grid", gridTemplateColumns: actValues && mctValues ? "1fr 1fr" : "1fr",
          gap: "1.25rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>

          {actValues && (
            <div style={{ display: "flex", gap: "1.25rem", alignItems: "center",
              padding: "1.25rem", background: "var(--surface-hover)", borderRadius: "var(--radius)",
              flexWrap: "wrap" }}>
              <div style={{ flex: "0 0 auto" }}>
                <p style={{ margin: "0 0 0.5rem", fontSize: "0.7rem", color: "var(--muted)",
                  textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>
                  ACT Гексафлекс
                </p>
                <RadarChart values={actValues} />
              </div>
              <div style={{ flex: 1, minWidth: "140px", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {actValues.map((v) => (
                  <ScoreBar key={v.label} label={v.label} value={v.value} color={ACT_COLOR} />
                ))}
              </div>
            </div>
          )}

          {mctValues && (
            <div style={{ display: "flex", gap: "1.25rem", alignItems: "center",
              padding: "1.25rem", background: "var(--surface-hover)", borderRadius: "var(--radius)",
              flexWrap: "wrap" }}>
              <div style={{ flex: "0 0 auto" }}>
                <p style={{ margin: "0 0 0.5rem", fontSize: "0.7rem", color: "var(--muted)",
                  textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>
                  МКТ-профиль
                </p>
                <RadarChart values={mctValues} />
              </div>
              <div style={{ flex: 1, minWidth: "140px", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {mctValues.map((v) => (
                  <ScoreBar key={v.label} label={v.label} value={v.value} color={MCT_COLOR} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Risk meter (standalone row if no radars, else separate) */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
        <RiskMeter riskNotes={analysis.risk_notes} />
      </div>

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

export default function ClientPage() {
  const params = useParams();
  const clientId = params.clientId as string;

  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisDate, setAnalysisDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<{ id: string; label: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.ok ? r.json() as Promise<{ models: { id: string; label: string }[] }> : null)
      .then((d) => {
        if (!d?.models?.length) return;
        setAvailableModels(d.models);
        const saved = localStorage.getItem("mct_analysis_model") ?? "";
        const found = d.models.find((m) => m.id === saved);
        setSelectedModel(found ? found.id : d.models[0].id);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    // Параллельная загрузка клиента и его последнего сохранённого аналитика
    Promise.all([
      fetch(`/api/therapist/client/${clientId}`).then((r) => r.json()),
      fetch(`/api/therapist/analysis/${clientId}`).then((r) => r.ok ? r.json() as Promise<{ analysis?: Analysis; created_at?: string }> : {})
    ])
      .then(([clientData, analysisData]) => {
        if (clientData.error) throw new Error(clientData.error);
        setDetail(clientData as ClientDetail);
        
        const ad = analysisData as { analysis?: Analysis; created_at?: string };
        if (ad.analysis) {
          setAnalysis(ad.analysis);
          setAnalysisDate(ad.created_at ?? null);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [clientId]);

  const loadAnalysis = async () => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const res = await fetch(`/api/therapist/analysis/${clientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel || undefined }),
      });
      const data = (await res.json()) as { analysis?: Analysis; created_at?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setAnalysis(data.analysis!);
      setAnalysisDate(data.created_at ?? null);
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
    interests: "Интересы",
    focus_area: "Зона фокуса",
    state: "Состояние",
    mood: "Настроение",
    family: "Семья",
    hobbies: "Хобби",
    symptoms: "Симптомы",
    challenges: "Сложности",
    triggers: "Триггеры",
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "absolute", right: "1.5rem", bottom: "1.5rem", width: "24px", opacity: 0.1 }}><path d="M12 2v20"/><path d="m4.93 4.93 14.14 14.14"/><path d="M2 12h20"/><path d="m19.07 4.93-14.14 14.14"/></svg>
              </div>
              <div className="dash-card">
                <span className="dash-card__value">
                  {detail.avg_duration_min != null ? `${Math.round(detail.avg_duration_min)} мин` : "—"}
                </span>
                <span className="dash-card__label">Ср. длительность</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "absolute", right: "1.5rem", bottom: "1.5rem", width: "24px", opacity: 0.1 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div className="dash-card">
                <span className="dash-card__value">{detail.homework_approved}/{detail.homework_total}</span>
                <span className="dash-card__label">ДЗ одобрено</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "absolute", right: "1.5rem", bottom: "1.5rem", width: "24px", opacity: 0.1 }}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              </div>
              <div className="dash-card">
                <span className="dash-card__value">{fmt(detail.last_session)}</span>
                <span className="dash-card__label">Последняя сессия</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "absolute", right: "1.5rem", bottom: "1.5rem", width: "24px", opacity: 0.1 }}><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </div>
            </div>

            <div className="dash-grid">
              {/* ── Charts ── */}
              <section className="dash-section dash-section--wide">
                <h2 className="dash-section__title">Активность</h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "2rem", alignItems: "start" }}>
                  <div>
                    <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Сессии — последние 28 дней
                    </p>
                    <SessionActivityChart sessions={detail.recent_sessions} />
                  </div>
                  <div>
                    <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Длительность сессий
                    </p>
                    <DurationChart sessions={detail.recent_sessions} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
                    <DonutChart
                      value={detail.homework_approved}
                      max={detail.homework_total}
                      label="ДЗ одобрено"
                      color="var(--accent)"
                    />
                    <DonutChart
                      value={detail.total_sessions}
                      max={Math.max(detail.total_sessions, 10)}
                      label="Сессий всего"
                      color="#10b981"
                    />
                  </div>
                </div>
              </section>

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
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <h2 className="dash-section__title" style={{ margin: 0 }}>Анализ ИИ</h2>
                    {analysisDate && (
                      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                        Сгенерирован: {fmt(analysisDate)} {fmtTime(analysisDate)}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    {availableModels.length > 1 && (
                      <div className="chat-model-selector" role="group" aria-label="Модель анализа">
                        {availableModels.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={`chat-model-btn${selectedModel === m.id ? " chat-model-btn--active" : ""}`}
                            onClick={() => {
                              setSelectedModel(m.id);
                              localStorage.setItem("mct_analysis_model", m.id);
                            }}
                            disabled={analysisLoading}
                            title={m.id}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className="dash-analysis-btn"
                      disabled={analysisLoading}
                      onClick={loadAnalysis}
                      style={{ fontSize: "0.9rem", padding: "0.5rem 1.25rem" }}
                    >
                      {analysisLoading
                        ? "Генерирую анализ…"
                        : analysis
                        ? "Обновить анализ"
                        : "Сгенерировать анализ"}
                    </button>
                  </div>
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
