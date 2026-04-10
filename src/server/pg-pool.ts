import { Pool } from "pg";
import { getDatabaseUrl } from "./database-url";

let pool: Pool | undefined;

/**
 * Один пул `pg` на процесс (удобно для своих SQL-запросов; LangGraph checkpointer использует своё соединение).
 * Без `DATABASE_URL` / аналогов возвращает `undefined`.
 */
export function getPgPool(): Pool | undefined {
  const url = getDatabaseUrl();
  if (!url) return undefined;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: Math.min(10, Number(process.env.PG_POOL_MAX ?? 5) || 5),
    });
    pool.on("error", (err) => {
      console.error("[pg-pool] idle client error:", err);
    });
  }
  return pool;
}

export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    closePgPool().catch((err) => {
      console.error("[pg-pool] error during shutdown:", err);
    });
  });
}
