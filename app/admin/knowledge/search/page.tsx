"use client";

import { useState, useRef } from "react";

type SearchResult = {
  id: string;
  content: string;
  score: number;
  source_title: string;
  metadata: { chunk_index?: number; file_name?: string };
};

type SearchResponse = {
  results: SearchResult[];
  mode: "vector" | "fulltext" | "none";
  error?: string;
};

function ModeTag({ mode }: { mode: "vector" | "fulltext" | "none" }) {
  if (mode === "vector") return (
    <span style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", borderRadius: "999px",
      background: "#eef2ff", color: "#6366f1", fontWeight: 600 }}>
      Векторный поиск
    </span>
  );
  if (mode === "fulltext") return (
    <span style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", borderRadius: "999px",
      background: "#f0fdf4", color: "#10b981", fontWeight: 600 }}>
      Full-text поиск
    </span>
  );
  return null;
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.min(score, 1);
  const color = pct >= 0.75 ? "#10b981" : pct >= 0.5 ? "#f59e0b" : "var(--muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
      <div style={{ width: "40px", height: "4px", background: "var(--border-subtle)", borderRadius: "2px" }}>
        <div style={{ height: "100%", borderRadius: "2px", background: color, width: `${pct * 100}%` }} />
      </div>
      <span style={{ fontSize: "0.75rem", color, fontWeight: 600, minWidth: "2.5rem" }}>
        {score.toFixed(3)}
      </span>
    </div>
  );
}

export default function KnowledgeSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [mode, setMode] = useState<"vector" | "fulltext" | "none">("none");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(false);
    try {
      const res = await fetch(`/api/admin/knowledge/search?q=${encodeURIComponent(query)}&limit=8`);
      const data = (await res.json()) as SearchResponse;
      if (data.error) throw new Error(data.error);
      setResults(data.results);
      setMode(data.mode);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка поиска");
    } finally {
      setLoading(false);
    }
  }

  function highlight(text: string, q: string): string {
    if (!q.trim()) return text;
    const words = q.trim().split(/\s+/).filter((w) => w.length > 3);
    if (!words.length) return text;
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return text.replace(re, "**$1**");
  }

  function renderContent(text: string, q: string) {
    const MAX = 500;
    const preview = text.length > MAX ? text.slice(0, MAX) + "…" : text;
    const hl = highlight(preview, q);
    const parts = hl.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) =>
      i % 2 === 1
        ? <mark key={i} style={{ background: "#fef3c7", padding: "0 2px", borderRadius: "2px" }}>{part}</mark>
        : <span key={i}>{part}</span>
    );
  }

  return (
    <div className="dash-shell">
      <header className="dash-nav">
        <div className="dash-nav__brand">
          <span className="dash-nav__dot" aria-hidden="true" />
          Поиск по базе знаний
        </div>
        <div className="dash-nav__actions">
          <a href="/admin/knowledge" className="mct-btn mct-btn--ghost mct-btn--sm">← База знаний</a>
          <a href="/therapist" className="mct-btn mct-btn--ghost mct-btn--sm">Дашборд</a>
        </div>
      </header>

      <main className="dash-main">
        <section className="dash-section dash-section--wide">
          <form onSubmit={handleSearch} style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Например: дефузия, руминация, ценности ACT, метакогниции..."
              autoFocus
              style={{
                flex: 1, padding: "0.65rem 1rem", borderRadius: "8px",
                border: "1px solid var(--border-subtle)", background: "var(--surface-hover)",
                fontSize: "0.95rem", color: "var(--text)",
              }}
            />
            <button type="submit" className="mct-btn mct-btn--primary" disabled={loading || !query.trim()}>
              {loading ? "Поиск…" : "Найти"}
            </button>
          </form>

          {error && <div className="dash-error" role="alert">{error}</div>}

          {searched && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                {results.length > 0 ? `Найдено: ${results.length} фрагментов` : "Ничего не найдено"}
              </span>
              <ModeTag mode={mode} />
            </div>
          )}

          {results.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {results.map((r) => (
                <div key={r.id} style={{
                  padding: "1.25rem", borderRadius: "var(--radius)",
                  border: "1px solid var(--border-subtle)", background: "var(--surface-hover)",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                    gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                    <div>
                      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--accent)" }}>
                        {r.source_title}
                      </span>
                      {r.metadata.chunk_index !== undefined && (
                        <span style={{ fontSize: "0.75rem", color: "var(--muted)", marginLeft: "0.5rem" }}>
                          чанк #{r.metadata.chunk_index}
                        </span>
                      )}
                    </div>
                    <ScoreBadge score={r.score} />
                  </div>
                  <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.6, color: "var(--text)", whiteSpace: "pre-wrap" }}>
                    {renderContent(r.content, query)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {searched && results.length === 0 && !error && (
            <div className="dash-empty">
              <p>По запросу «{query}» ничего не найдено в базе знаний.</p>
              {mode === "fulltext" && (
                <p style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
                  Совет: добавьте VOYAGE_API_KEY и переиндексируйте для семантического поиска.
                </p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
