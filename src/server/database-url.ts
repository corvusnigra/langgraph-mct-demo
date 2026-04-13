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
  // Vercel Neon integration
  "DATABASE_POSTGRES_URL_NON_POOLING",
  "DATABASE_POSTGRES_URL_NO_SSL",
] as const;

export function getDatabaseUrl(): string | undefined {
  for (const key of URL_KEYS) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return undefined;
}
