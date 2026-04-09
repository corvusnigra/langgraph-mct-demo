import { NextResponse } from "next/server";
import { getPgPool } from "@/src/server/pg-pool";

export const runtime = "nodejs";

/**
 * GET /api/db-health — проверка подключения к Postgres (`SELECT 1`).
 * Не требует ANTHROPIC_API_KEY. Удобно после настройки DATABASE_URL / POSTGRES_URL / STORAGE_URL на Vercel.
 */
export async function GET() {
  const pool = getPgPool();
  if (!pool) {
    return NextResponse.json(
      {
        ok: false,
        error: "Строка подключения к Postgres не задана",
        hint:
          "Задайте одну из переменных: DATABASE_URL, POSTGRES_URL, POSTGRES_PRISMA_URL, STORAGE_URL, NEON_DATABASE_URL",
      },
      { status: 503 }
    );
  }

  try {
    const r = await pool.query("SELECT 1 AS ok");
    const row = r.rows[0] as { ok?: number };
    return NextResponse.json({
      ok: true,
      query: "SELECT 1",
      result: row?.ok ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[db-health]", message);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        hint: "Проверьте строку подключения, SSL и доступ с Vercel к Neon (allowed IPs обычно не нужны).",
      },
      { status: 502 }
    );
  }
}
