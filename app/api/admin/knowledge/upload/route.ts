import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUser } from "@/src/server/auth";
import { chunkText } from "@/src/embeddings/chunker";
import { storeChunks } from "@/src/embeddings/vector-store";
import { getPgPool } from "@/src/server/pg-pool";

export const runtime = "nodejs";
export const maxDuration = 120;

async function extractText(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (file.name.endsWith(".pdf")) {
    // pdf-parse v2 ESM — экспортирует функцию напрямую
    const parse = (await import("pdf-parse")) as unknown as (b: Buffer) => Promise<{ text: string }>;
    const data = await parse(buf);
    return data.text;
  }
  return buf.toString("utf-8");
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user || (user.role !== "therapist" && user.role !== "admin")) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const title =
    (formData.get("title") as string) || file?.name || "Без названия";

  if (!file)
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });

  const text = await extractText(file);
  if (!text.trim())
    return NextResponse.json(
      { error: "Не удалось извлечь текст" },
      { status: 422 }
    );

  const chunks = chunkText(text);

  // Создаём источник в БД
  const pool = getPgPool();
  let sourceId = crypto.randomUUID();
  if (pool) {
    try {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO mct_knowledge_sources (title, source_type, file_name, chunk_count)
         VALUES ($1, 'uploaded', $2, $3) RETURNING id`,
        [title, file.name, chunks.length]
      );
      sourceId = rows[0].id;
    } catch (err) {
      console.warn("[upload] DB insert source failed, using random UUID:", err);
    }
  }

  await storeChunks(
    sourceId,
    chunks.map((content, i) => ({
      content,
      metadata: { source: title, file_name: file.name, chunk_index: i },
    }))
  );

  return NextResponse.json({ ok: true, sourceId, chunks: chunks.length });
}
