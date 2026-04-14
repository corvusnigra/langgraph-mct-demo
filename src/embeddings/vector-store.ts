import { getPgPool } from "../server/pg-pool";
import { embedTexts, DIMS } from "./voyage-client";
import { MCT_REFERENCE } from "../mct-reference";
import { EXERCISES } from "../data";

// ── In-memory fallback ────────────────────────────────────────────────────────

type VecEntry = {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  sourceType: "builtin" | "uploaded";
};

const memStore: VecEntry[] = [];
let builtinInitialized = false;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Corpus init ───────────────────────────────────────────────────────────────

/**
 * Инициализирует встроенный корпус (MCT_REFERENCE + упражнения) при старте.
 * При наличии Postgres и pgvector — сохраняет туда. Иначе — in-memory.
 */
export async function initCorpusEmbeddings(): Promise<void> {
  if (builtinInitialized) return;
  builtinInitialized = true;

  const builtinTexts: Array<{ id: string; content: string; metadata: Record<string, unknown> }> = [];

  for (const chunk of MCT_REFERENCE) {
    builtinTexts.push({
      id: `mct-ref-${chunk.title.slice(0, 40).replace(/\s+/g, "-")}`,
      content: `### ${chunk.title}\n${chunk.content}`,
      metadata: { source: "MCT_REFERENCE", title: chunk.title, sourceType: "builtin" },
    });
  }

  for (const ex of EXERCISES) {
    builtinTexts.push({
      id: `exercise-${ex.exercise_id}`,
      content: `### ${ex.title}\n${ex.goal_summary}\nТэги: ${ex.focus_tags.join(", ")}\nДомен: ${ex.domain}`,
      metadata: { source: "EXERCISES", exercise_id: ex.exercise_id, domain: ex.domain, sourceType: "builtin" },
    });
  }

  const pool = getPgPool();
  const texts = builtinTexts.map((t) => t.content);
  const embeddings = await embedTexts(texts, "document");

  if (pool && embeddings) {
    // Пробуем сохранить в Postgres
    try {
      // Проверяем, не инициализированы ли уже встроенные чанки
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM mct_knowledge_chunks WHERE source_id IS NULL`
      );
      if (parseInt(rows[0].count) > 0) {
        console.log(`[embeddings] builtin corpus already in DB (${rows[0].count} chunks), skipping`);
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let i = 0; i < builtinTexts.length; i++) {
          const item = builtinTexts[i];
          const emb = embeddings[i];
          await client.query(
            `INSERT INTO mct_knowledge_chunks (source_id, content, embedding, metadata, chunk_index)
             VALUES (NULL, $1, $2::vector, $3, $4)
             ON CONFLICT DO NOTHING`,
            [item.content, `[${emb.join(",")}]`, JSON.stringify(item.metadata), i]
          );
        }
        await client.query("COMMIT");
        console.log(`[embeddings] builtin corpus stored in DB (${builtinTexts.length} chunks)`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      return;
    } catch (err) {
      console.warn("[embeddings] DB store failed, falling back to in-memory:", err);
    }
  }

  // In-memory fallback
  if (embeddings) {
    for (let i = 0; i < builtinTexts.length; i++) {
      memStore.push({
        id: builtinTexts[i].id,
        content: builtinTexts[i].content,
        embedding: embeddings[i],
        metadata: builtinTexts[i].metadata,
        sourceType: "builtin",
      });
    }
    console.log(`[embeddings] builtin corpus stored in-memory (${builtinTexts.length} chunks)`);
  } else {
    console.log("[embeddings] Voyage API недоступен — builtin corpus без эмбеддингов");
  }
}

// ── Semantic search ───────────────────────────────────────────────────────────

export async function semanticSearch(
  query: string,
  opts?: { limit?: number; sourceType?: "builtin" | "uploaded" | "all" }
): Promise<Array<{ id: string; content: string; score: number; metadata: Record<string, unknown> }> | null> {
  const limit = opts?.limit ?? 3;
  const sourceFilter = opts?.sourceType ?? "all";

  const queryEmbedding = await embedTexts([query], "query");
  if (!queryEmbedding) return null;
  const qVec = queryEmbedding[0];

  const pool = getPgPool();

  if (pool) {
    try {
      let whereClause = "";
      if (sourceFilter === "builtin") {
        whereClause = "WHERE source_id IS NULL";
      } else if (sourceFilter === "uploaded") {
        whereClause = "WHERE source_id IS NOT NULL";
      }

      const { rows } = await pool.query<{
        id: string;
        content: string;
        metadata: Record<string, unknown>;
        score: number;
      }>(
        `SELECT id::text, content, metadata,
                1 - (embedding <=> $1::vector) AS score
         FROM mct_knowledge_chunks
         ${whereClause}
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [`[${qVec.join(",")}]`, limit]
      );
      return rows.map((r) => ({
        id: r.id,
        content: r.content,
        score: r.score,
        metadata: r.metadata,
      }));
    } catch (err) {
      console.warn("[embeddings] DB search failed, falling back to in-memory:", err);
    }
  }

  // In-memory fallback
  const candidates = sourceFilter === "all"
    ? memStore
    : memStore.filter((e) => e.sourceType === sourceFilter);

  const scored = candidates.map((e) => ({
    id: e.id,
    content: e.content,
    score: cosineSimilarity(qVec, e.embedding),
    metadata: e.metadata,
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ── Store chunks ──────────────────────────────────────────────────────────────

export async function storeChunks(
  sourceId: string,
  chunks: Array<{ content: string; metadata?: Record<string, unknown> }>
): Promise<void> {
  const texts = chunks.map((c) => c.content);
  const embeddings = await embedTexts(texts, "document");

  const pool = getPgPool();

  if (pool && embeddings) {
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const emb = embeddings[i];
          await client.query(
            `INSERT INTO mct_knowledge_chunks (source_id, content, embedding, metadata, chunk_index)
             VALUES ($1::uuid, $2, $3::vector, $4, $5)`,
            [
              sourceId,
              chunk.content,
              `[${emb.join(",")}]`,
              JSON.stringify(chunk.metadata ?? {}),
              i,
            ]
          );
        }
        await client.query("COMMIT");
        console.log(`[embeddings] stored ${chunks.length} chunks for source ${sourceId}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      return;
    } catch (err) {
      console.warn("[embeddings] DB store failed, falling back to in-memory:", err);
    }
  }

  // In-memory fallback
  if (embeddings) {
    for (let i = 0; i < chunks.length; i++) {
      memStore.push({
        id: `${sourceId}-${i}`,
        content: chunks[i].content,
        embedding: embeddings[i],
        metadata: chunks[i].metadata ?? {},
        sourceType: "uploaded",
      });
    }
  }
}

// ── Delete source ─────────────────────────────────────────────────────────────

export async function deleteSource(sourceId: string): Promise<void> {
  const pool = getPgPool();
  if (pool) {
    try {
      await pool.query(`DELETE FROM mct_knowledge_sources WHERE id = $1::uuid`, [sourceId]);
      // mct_knowledge_chunks удалятся каскадно
      return;
    } catch (err) {
      console.warn("[embeddings] DB delete failed:", err);
    }
  }

  // In-memory fallback: удаляем чанки по prefix sourceId
  const before = memStore.length;
  for (let i = memStore.length - 1; i >= 0; i--) {
    if (memStore[i].id.startsWith(sourceId)) {
      memStore.splice(i, 1);
    }
  }
  console.log(`[embeddings] in-memory: removed ${before - memStore.length} chunks for ${sourceId}`);
}

// ── List sources ──────────────────────────────────────────────────────────────

export async function listSources(): Promise<
  Array<{ id: string; title: string; source_type: string; chunk_count: number; created_at: Date }>
> {
  const pool = getPgPool();
  if (pool) {
    try {
      const { rows } = await pool.query<{
        id: string;
        title: string;
        source_type: string;
        chunk_count: number;
        created_at: Date;
      }>(`SELECT id::text, title, source_type, chunk_count, created_at
          FROM mct_knowledge_sources
          ORDER BY created_at DESC`);
      return rows;
    } catch (err) {
      console.warn("[embeddings] DB listSources failed:", err);
    }
  }

  // In-memory: нет источников (чанки анонимны)
  return [];
}

export { DIMS };
