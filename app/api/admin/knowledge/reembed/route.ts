/**
 * POST /api/admin/knowledge/reembed
 * Переиндексирует чанки без эмбеддингов (embedding IS NULL), по 10 за вызов.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUser } from "@/src/server/auth";
import { getPgPool } from "@/src/server/pg-pool";
import { embedTexts, isVoyageAvailable } from "@/src/embeddings/voyage-client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await getUser(req);
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
    }

    if (!isVoyageAvailable()) {
      return NextResponse.json({ error: "VOYAGE_API_KEY не задан" }, { status: 400 });
    }

    const pool = getPgPool();
    if (!pool) return NextResponse.json({ error: "Postgres не настроен" }, { status: 500 });

    const { rows: countRows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM mct_knowledge_chunks WHERE embedding IS NULL`
    );
    const totalNull = parseInt(countRows[0].cnt, 10);
    console.log(`[reembed] null chunks: ${totalNull}`);

    if (totalNull === 0) {
      return NextResponse.json({ ok: true, updated: 0, remaining: 0, message: "Все чанки уже имеют эмбеддинги" });
    }

    const LIMIT = 10;
    const { rows } = await pool.query<{ id: string; content: string }>(
      `SELECT id::text, content FROM mct_knowledge_chunks WHERE embedding IS NULL ORDER BY chunk_index LIMIT $1`,
      [LIMIT]
    );
    console.log(`[reembed] fetched ${rows.length} chunks to embed`);

    console.log(`[reembed] calling Voyage AI...`);
    const embeddings = await embedTexts(rows.map((r) => r.content), "document");
    if (!embeddings) {
      return NextResponse.json({ error: "Voyage AI вернул null — ключ недействителен?" }, { status: 502 });
    }
    console.log(`[reembed] got ${embeddings.length} embeddings`);

    let updated = 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let j = 0; j < rows.length; j++) {
        await client.query(
          `UPDATE mct_knowledge_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
          [`[${embeddings[j].join(",")}]`, rows[j].id]
        );
        updated++;
      }
      await client.query("COMMIT");
      console.log(`[reembed] committed ${updated} updates`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[reembed] DB error:`, err);
      throw err;
    } finally {
      client.release();
    }

    const remaining = totalNull - updated;
    console.log(`[reembed] done. updated=${updated} remaining=${remaining}`);
    return NextResponse.json({ ok: true, updated, remaining, total: totalNull });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[reembed] unhandled error:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
