/**
 * Прямая загрузка PDF в базу знаний (без веб-сервера, без voyageai).
 * Сохраняет чанки как текст; поиск работает через pg full-text / ILIKE.
 *
 * Использование: tsx scripts/ingest-pdf.ts "путь/к/файлу.pdf" "Заголовок"
 */
import { readFileSync } from "fs";
import { basename } from "path";
import { chunkText } from "../src/embeddings/chunker";
import { getPgPool } from "../src/server/pg-pool";
import { setupDbSchema } from "../src/server/db-schema";

async function main() {
  const filePath = process.argv[2];
  const title = process.argv[3] || basename(filePath || "", ".pdf");

  if (!filePath) {
    console.error("Укажи путь к файлу: tsx scripts/ingest-pdf.ts <path> [title]");
    process.exit(1);
  }

  console.log(`📖 Читаю: ${filePath}`);
  const buf = readFileSync(filePath);

  console.log("🔍 Извлекаю текст из PDF…");
  const { PDFParse } = await import("pdf-parse") as unknown as { PDFParse: new (opts: object) => { getText(): Promise<{ text: unknown; total: { pageCount: number } }> } };
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const pdfResult = await parser.getText();
  const text = Array.isArray(pdfResult.text) ? (pdfResult.text as string[]).join("\n") : String(pdfResult.text);
  const numpages = pdfResult.total?.pageCount ?? "?";
  console.log(`   ${numpages} страниц, ${text.length.toLocaleString()} символов`);

  if (!text.trim()) {
    console.error("❌ Не удалось извлечь текст из PDF");
    process.exit(1);
  }

  console.log("✂️  Разбиваю на чанки…");
  const chunks = chunkText(text);
  console.log(`   ${chunks.length} чанков`);

  await setupDbSchema();
  const pool = getPgPool();
  if (!pool) { console.error("❌ Postgres не настроен"); process.exit(1); }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO mct_knowledge_sources (title, source_type, file_name, chunk_count)
     VALUES ($1, 'uploaded', $2, $3) RETURNING id`,
    [title, basename(filePath), chunks.length]
  );
  const sourceId = rows[0].id;
  console.log(`💾 Источник: ${sourceId}`);

  const BATCH = 50;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO mct_knowledge_chunks (source_id, content, metadata, chunk_index)
         VALUES ($1::uuid, $2, $3, $4)`,
        [
          sourceId,
          chunks[i],
          JSON.stringify({ source: title, file_name: basename(filePath), chunk_index: i }),
          i,
        ]
      );
      if ((i + 1) % BATCH === 0 || i === chunks.length - 1) {
        process.stdout.write(`\r   Сохранено: ${i + 1}/${chunks.length}`);
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(`\n✅ Готово! «${title}» — ${chunks.length} чанков в базе знаний.`);
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Ошибка:", e.message ?? e);
  process.exit(1);
});
