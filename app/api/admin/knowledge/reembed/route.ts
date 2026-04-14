/**
 * POST /api/admin/knowledge/reembed
 * Переиндексирует все чанки без эмбеддингов (embedding IS NULL).
 * Вызывается из панели базы знаний после добавления VOYAGE_API_KEY.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUser } from "@/src/server/auth";
import { getPgPool } from "@/src/server/pg-pool";
import { embedTexts, isVoyageAvailable } from "@/src/embeddings/voyage-client";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  if (!isVoyageAvailable()) {
    return NextResponse.json({ error: "VOYAGE_API_KEY не задан" }, { status: 400 });
  }

  const pool = getPgPool();
  if (!pool) return NextResponse.json({ error: "Postgres не настроен" }, { status: 500 });

  // Считаем сколько всего без эмбеддингов
  const { rows: countRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM mct_knowledge_chunks WHERE embedding IS NULL`
  );
  const totalNull = parseInt(countRows[0].cnt, 10);

  if (totalNull === 0) {
    return NextResponse.json({ ok: true, updated: 0, remaining: 0, message: "Все чанки уже имеют эмбеддинги" });
  }

  // Обрабатываем за один вызов не более 256 чанков (≈2 батча Voyage, укладывается в таймаут)
  const LIMIT = 10;
  const { rows } = await pool.query<{ id: string; content: string }>(
    `SELECT id::text, content FROM mct_knowledge_chunks WHERE embedding IS NULL ORDER BY chunk_index LIMIT $1`,
    [LIMIT]
  );

  const BATCH = 10;
  let updated = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const embeddings = await embedTexts(batch.map((r) => r.content), "document");
    if (!embeddings) continue;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let j = 0; j < batch.length; j++) {
        await client.query(
          `UPDATE mct_knowledge_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
          [`[${embeddings[j].join(",")}]`, batch[j].id]
        );
        updated++;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  const remaining = totalNull - updated;
  return NextResponse.json({ ok: true, updated, remaining, total: totalNull });
}
