import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getPgPool } from "./pg-pool";
import { setupDbSchema } from "./db-schema";

export interface User {
  id: string;
  email: string;
  role: "client" | "therapist" | "admin";
}

const SESSION_COOKIE = "mct_session";
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 минут
const SESSION_TTL_DAYS = 30;

import { getCheckpointSaver } from "./checkpointer";

async function ensurePool() {
  await getCheckpointSaver(); // гарантирует настройку схемы БД без гонок
  const pool = getPgPool();
  if (!pool) throw new Error("Postgres не настроен");
  return pool;
}

// ── Magic token ────────────────────────────────────────────────────────────────

/**
 * Создаёт пользователя (если не существует) и одноразовый magic-link токен.
 */
export async function createMagicToken(email: string): Promise<string> {
  const pool = await ensurePool();
  const normalizedEmail = email.toLowerCase().trim();

  // Upsert user
  await pool.query(
    `INSERT INTO mct_users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
    [normalizedEmail]
  );
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM mct_users WHERE email = $1`,
    [normalizedEmail]
  );
  const userId = rows[0].id;

  // Create token
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await pool.query(
    `INSERT INTO mct_auth_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );

  return token;
}

/**
 * Проверяет токен: помечает использованным и возвращает пользователя (или null).
 */
export async function verifyMagicToken(token: string): Promise<User | null> {
  const pool = await ensurePool();

  const { rows } = await pool.query<{
    user_id: string;
    expires_at: Date;
    used: boolean;
  }>(
    `SELECT user_id, expires_at, used FROM mct_auth_tokens WHERE token = $1`,
    [token]
  );

  if (!rows.length) return null;
  const row = rows[0];
  if (row.used) return null;
  if (new Date() > row.expires_at) return null;

  // Mark used
  await pool.query(`UPDATE mct_auth_tokens SET used = true WHERE token = $1`, [token]);

  const { rows: userRows } = await pool.query<User>(
    `SELECT id, email, role FROM mct_users WHERE id = $1`,
    [row.user_id]
  );
  return userRows[0] ?? null;
}

// ── Session ────────────────────────────────────────────────────────────────────

export async function createSession(userId: string): Promise<string> {
  const pool = await ensurePool();
  const sessionToken = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO mct_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, sessionToken, expiresAt]
  );
  return sessionToken;
}

export async function getUser(req: NextRequest): Promise<User | null> {
  const pool = getPgPool();
  if (!pool) return null;

  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionToken) return null;

  const { rows } = await pool.query<{ user_id: string; expires_at: Date }>(
    `SELECT user_id, expires_at FROM mct_sessions WHERE token = $1`,
    [sessionToken]
  );
  if (!rows.length) return null;
  if (new Date() > rows[0].expires_at) return null;

  const { rows: userRows } = await pool.query<User>(
    `SELECT id, email, role FROM mct_users WHERE id = $1`,
    [rows[0].user_id]
  );
  return userRows[0] ?? null;
}

export async function deleteSession(sessionToken: string): Promise<void> {
  const pool = getPgPool();
  if (!pool) return;
  await pool.query(`DELETE FROM mct_sessions WHERE token = $1`, [sessionToken]);
}

export { SESSION_COOKIE };
