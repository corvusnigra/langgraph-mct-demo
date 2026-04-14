import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUser } from "@/src/server/auth";
import { getPgPool } from "@/src/server/pg-pool";
import { embedTexts, isVoyageAvailable } from "@/src/embeddings/voyage-client";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [], mode: "none" });

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "8", 10), 20);
  const pool = getPgPool();
  if (!pool) return NextResponse.json({ error: "Postgres не настроен" }, { status: 500 });

  // Векторный поиск если Voyage доступен
  if (isVoyageAvailable()) {
    const embeddings = await embedTexts([q], "query");
    if (embeddings) {
      const vec = `[${embeddings[0].join(",")}]`;
      const { rows } = await pool.query<{
        id: string; content: string; metadata: Record<string, unknown>;
        score: number; source_title: string;
      }>(
        `SELECT c.id::text, c.content, c.metadata,
                ROUND((1 - (c.embedding <=> $1::vector))::numeric, 3) AS score,
                COALESCE(s.title, 'Встроенный справочник') AS source_title
         FROM mct_knowledge_chunks c
         LEFT JOIN mct_knowledge_sources s ON c.source_id = s.id
         WHERE c.embedding IS NOT NULL
         ORDER BY c.embedding <=> $1::vector
         LIMIT $2`,
        [vec, limit]
      );
      return NextResponse.json({ results: rows, mode: "vector" });
    }
  }

  // Fallback: pg full-text search
  const { rows } = await pool.query<{
    id: string; content: string; metadata: Record<string, unknown>;
    score: number; source_title: string;
  }>(
    `SELECT c.id::text, c.content, c.metadata,
            ROUND(ts_rank(to_tsvector('russian', c.content), plainto_tsquery('russian', $1))::numeric, 3) AS score,
            COALESCE(s.title, 'Встроенный справочник') AS source_title
     FROM mct_knowledge_chunks c
     LEFT JOIN mct_knowledge_sources s ON c.source_id = s.id
     WHERE to_tsvector('russian', c.content) @@ plainto_tsquery('russian', $1)
     ORDER BY score DESC
     LIMIT $2`,
    [q, limit]
  );
  return NextResponse.json({ results: rows, mode: "fulltext" });
}
