/**
 * Единая строка подключения к Postgres.
 * Vercel/Neon могут задавать разные имена переменных — перебираем в порядке приоритета.
 */
const URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "STORAGE_URL",
  "NEON_DATABASE_URL",
] as const;

export function getDatabaseUrl(): string | undefined {
  for (const key of URL_KEYS) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return undefined;
}
