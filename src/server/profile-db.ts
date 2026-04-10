import { getPgPool } from "./pg-pool";
import { loadProfile, saveProfile } from "../profile-store";

/**
 * Загружает профиль пользователя из Postgres (mct_profiles).
 * Без userId или без Postgres — фолбэк на файловый профиль.
 */
export async function loadProfileForUser(
  userId?: string
): Promise<Record<string, string>> {
  if (!userId) return loadProfile();
  const pool = getPgPool();
  if (!pool) return loadProfile();

  const { rows } = await pool.query<{ data: Record<string, string> }>(
    `SELECT data FROM mct_profiles WHERE user_id = $1`,
    [userId]
  );
  return rows[0]?.data ?? {};
}

/**
 * Сохраняет профиль пользователя в Postgres (upsert).
 * Без userId или без Postgres — фолбэк на файловый профиль.
 */
export async function saveProfileForUser(
  profile: Record<string, string>,
  userId?: string
): Promise<void> {
  if (!userId) return saveProfile(profile);
  const pool = getPgPool();
  if (!pool) return saveProfile(profile);

  await pool.query(
    `INSERT INTO mct_profiles (user_id, data, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = now()`,
    [userId, JSON.stringify(profile)]
  );
}
