"use client";

import { useEffect, useRef, useState } from "react";

type Source = {
  id: string;
  title: string;
  source_type: string;
  chunk_count: number;
  created_at: string;
};

function fmt(d: string) {
  return new Date(d).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function KnowledgePage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [voyageAvailable, setVoyageAvailable] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadSources() {
    try {
      const res = await fetch("/api/admin/knowledge");
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { sources: Source[] };
      setSources(data.sources);
    } catch {
      setError("Ошибка загрузки списка источников");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSources();
    // Проверяем наличие Voyage через db-health или просто пробуем GET
    fetch("/api/db-health")
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as Record<string, unknown>;
        // Voyage availability определяем по env — если ключ есть, будет работать
        // Используем кастомный header если есть, иначе просто true (оптимистично)
        setVoyageAvailable(
          typeof data.voyage === "boolean" ? data.voyage : null
        );
      })
      .catch(() => setVoyageAvailable(null));
  }, []);

  async function handleUpload(file: File) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title || file.name);
      const res = await fetch("/api/admin/knowledge/upload", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        chunks?: number;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Ошибка загрузки");
      }
      setTitle("");
      await loadSources();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки файла");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить источник и все его чанки?")) return;
    try {
      const res = await fetch("/api/admin/knowledge", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Ошибка удаления");
      setSources((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setError("Ошибка при удалении источника");
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  }

  return (
    <div className="dash-shell">
      <header className="dash-nav">
        <div className="dash-nav__brand">
          <span className="dash-nav__dot" aria-hidden="true" />
          База знаний
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
        {voyageAvailable === false && (
          <div
            className="dash-error"
            role="alert"
            style={{ marginBottom: "1rem" }}
          >
            Voyage AI недоступен: переменная VOYAGE_API_KEY не задана.
            Семантический поиск работать не будет — загрузка файлов сохранит
            текст без эмбеддингов.
          </div>
        )}

        {error && (
          <div className="dash-error" role="alert">
            {error}
          </div>
        )}

        {/* Upload section */}
        <section className="dash-section">
          <h2 className="dash-section__title">Загрузить документ</h2>

          <div style={{ marginBottom: "0.75rem" }}>
            <label
              htmlFor="kb-title"
              style={{
                display: "block",
                marginBottom: "0.25rem",
                fontSize: "0.875rem",
                opacity: 0.7,
              }}
            >
              Название источника (необязательно)
            </label>
            <input
              id="kb-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: «Книга Уэллса по МКТ»"
              style={{
                width: "100%",
                maxWidth: "480px",
                padding: "0.5rem 0.75rem",
                borderRadius: "6px",
                border: "1px solid var(--border, #e2e8f0)",
                background: "var(--surface, #fff)",
                fontSize: "0.9rem",
              }}
            />
          </div>

          {/* Drag-and-drop zone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Зона загрузки файла"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ")
                fileInputRef.current?.click();
            }}
            style={{
              border: `2px dashed ${dragOver ? "var(--accent, #6366f1)" : "var(--border, #e2e8f0)"}`,
              borderRadius: "12px",
              padding: "2.5rem 1.5rem",
              textAlign: "center",
              cursor: uploading ? "not-allowed" : "pointer",
              background: dragOver
                ? "var(--accent-soft, #eef2ff)"
                : "transparent",
              transition: "all 0.15s",
              opacity: uploading ? 0.6 : 1,
            }}
          >
            {uploading ? (
              <div className="dash-loading" style={{ justifyContent: "center" }}>
                <span className="dash-loading__dot" />
                <span className="dash-loading__dot" />
                <span className="dash-loading__dot" />
                <span style={{ marginLeft: "0.5rem" }}>Загрузка...</span>
              </div>
            ) : (
              <>
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  style={{ margin: "0 auto 0.75rem", opacity: 0.4 }}
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p style={{ margin: 0, opacity: 0.6, fontSize: "0.9rem" }}>
                  Перетащите файл сюда или нажмите для выбора
                </p>
                <p
                  style={{
                    margin: "0.25rem 0 0",
                    opacity: 0.4,
                    fontSize: "0.8rem",
                  }}
                >
                  PDF, TXT, MD
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md"
            style={{ display: "none" }}
            onChange={onFileChange}
          />
        </section>

        {/* Sources list */}
        <section className="dash-section dash-section--full">
          <h2 className="dash-section__title">
            Загруженные источники
            {sources.length > 0 && (
              <span className="dash-badge" style={{ marginLeft: "0.5rem" }}>
                {sources.length}
              </span>
            )}
          </h2>

          {loading ? (
            <div className="dash-loading">
              <span className="dash-loading__dot" />
              <span className="dash-loading__dot" />
              <span className="dash-loading__dot" />
            </div>
          ) : sources.length === 0 ? (
            <div className="dash-empty">
              <svg
                width="40"
                height="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                style={{ opacity: 0.35, margin: "0 auto 0.5rem" }}
              >
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              <p>Источников пока нет. Загрузите первый документ выше.</p>
            </div>
          ) : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Тип</th>
                    <th>Чанков</th>
                    <th>Добавлен</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.id}>
                      <td className="dash-table__email">{s.title}</td>
                      <td>
                        <span className="dash-tag">{s.source_type}</span>
                      </td>
                      <td>{s.chunk_count}</td>
                      <td className="dash-table__muted">{fmt(s.created_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="mct-btn mct-btn--ghost mct-btn--sm"
                          onClick={() => handleDelete(s.id)}
                          style={{ color: "var(--error, #ef4444)" }}
                        >
                          Удалить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
