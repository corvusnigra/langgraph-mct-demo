/**
 * Локальная переиндексация: добавляет эмбеддинги всем чанкам с embedding IS NULL.
 * Использует Voyage AI REST API напрямую (без voyageai npm пакета).
 */
import { getPgPool } from "../src/server/pg-pool";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY!;
const VOYAGE_MODEL = process.env.VOYAGE_MODEL ?? "voyage-3-lite";
const BATCH = 128;

async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: texts, model: VOYAGE_MODEL, input_type: "document" }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${err}`);
  }
  const data = await res.json() as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}

async function main() {
  if (!VOYAGE_API_KEY) { console.error("❌ VOYAGE_API_KEY не задан"); process.exit(1); }

  const pool = getPgPool();
  if (!pool) { console.error("❌ DATABASE_URL не задан"); process.exit(1); }

  const { rows: total } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM mct_knowledge_chunks WHERE embedding IS NULL`
  );
  const totalNull = parseInt(total[0].cnt, 10);
  console.log(`📊 Чанков без эмбеддингов: ${totalNull}`);
  if (totalNull === 0) { console.log("✅ Всё уже проиндексировано"); await pool.end(); return; }

  const { rows } = await pool.query<{ id: string; content: string }>(
    `SELECT id::text, content FROM mct_knowledge_chunks WHERE embedding IS NULL ORDER BY chunk_index`
  );

  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    process.stdout.write(`\r🧠 ${updated}/${totalNull} — батч ${Math.floor(i/BATCH)+1}…`);
    const embeddings = await embedTexts(batch.map((r) => r.content));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let j = 0; j < batch.length; j++) {
        await client.query(
          `UPDATE mct_knowledge_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
          [`[${embeddings[j].join(",")}]`, batch[j].id]
        );
      }
      await client.query("COMMIT");
      updated += batch.length;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`\n✅ Готово! Проиндексировано: ${updated}/${totalNull}`);
  await pool.end();
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
