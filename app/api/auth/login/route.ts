import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hashPassword, verifyPassword, createSession } from "@/src/server/auth";
import { getPgPool } from "@/src/server/pg-pool";
import { setupDbSchema } from "@/src/server/db-schema";
import { isRateLimited } from "@/src/server/rate-limit";
import { SESSION_COOKIE } from "@/src/server/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
  if (await isRateLimited(ip)) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 });
  }

  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Укажите корректный email" }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "Пароль должен быть не менее 6 символов" }, { status: 400 });
  }

  try {
    await setupDbSchema();
  } catch (err) {
    console.error("[login] setupDbSchema failed:", err);
    return NextResponse.json({ error: "Ошибка инициализации БД" }, { status: 500 });
  }
  const pool = getPgPool();
  if (!pool) {
    return NextResponse.json({ error: "База данных недоступна" }, { status: 500 });
  }

  let userId: string;

  try {
    // Ищем пользователя
    const { rows } = await pool.query<{ id: string; password_hash: string | null; role: string }>(
      `SELECT id, password_hash, role FROM mct_users WHERE email = $1`,
      [email]
    );

    if (rows.length === 0) {
      // Новый пользователь — регистрируем
      const hash = await hashPassword(password);
      const { rows: newUser } = await pool.query<{ id: string }>(
        `INSERT INTO mct_users (email, password_hash) VALUES ($1, $2) RETURNING id`,
        [email, hash]
      );
      userId = newUser[0].id;
    } else {
      const user = rows[0];
      if (!user.password_hash) {
        // Существующий пользователь без пароля (magic link) — устанавливаем пароль
        const hash = await hashPassword(password);
        await pool.query(`UPDATE mct_users SET password_hash = $1 WHERE id = $2`, [hash, user.id]);
        userId = user.id;
      } else {
        // Проверяем пароль
        const ok = await verifyPassword(password, user.password_hash);
        if (!ok) {
          return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
        }
        userId = user.id;
      }
    }
  } catch (err) {
    console.error("[login] DB error:", err);
    return NextResponse.json({ error: "Ошибка базы данных" }, { status: 500 });
  }

  const sessionToken = await createSession(userId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });
  return res;
}
