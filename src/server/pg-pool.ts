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
  }
  return pool;
}
