import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * На Vercel (и в других read-only средах) `process.cwd()` = /var/task — нельзя писать.
 * Используем /tmp для эфемерного хранения; на Postgres-инстансах файл вообще не нужен.
 */
const DATA_DIR = process.env.VERCEL
  ? "/tmp"
  : join(process.cwd(), "data");
export const PROFILE_PATH = join(DATA_DIR, "client_profile.json");

export async function loadProfile(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(PROFILE_PATH, "utf-8");
    const data = JSON.parse(raw) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, string>;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[profile-store] ошибка чтения профиля:", err);
    }
  }
  return {};
}

export async function saveProfile(profile: Record<string, string>): Promise<void> {
  await mkdir(dirname(PROFILE_PATH), { recursive: true });
  await writeFile(PROFILE_PATH, JSON.stringify(profile, null, 2), "utf-8");
}

export function formatProfileBlock(profile: Record<string, string>): string {
  if (Object.keys(profile).length === 0) {
    return "\n## Текущий профиль клиента\n  (пусто — данных ещё нет)\n";
  }
  const lines = Object.entries(profile).map(([k, v]) => `  ${k}: ${v}`);
  return `\n## Текущий профиль клиента\n${lines.join("\n")}\n`;
}
