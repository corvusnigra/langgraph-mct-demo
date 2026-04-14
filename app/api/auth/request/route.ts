import { NextResponse } from "next/server";
import { createMagicToken } from "@/src/server/auth";
import { sendMagicLink } from "@/src/server/email";
import { isRateLimited } from "@/src/server/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
  if (await isRateLimited(ip)) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Укажите корректный email" }, { status: 400 });
  }

  let token: string;
  try {
    token = await createMagicToken(email);
  } catch (err) {
    console.error("[auth/request] createMagicToken failed:", err);
    return NextResponse.json(
      { error: "Ошибка создания токена (база данных недоступна)" },
      { status: 500 }
    );
  }

  // Если RESEND не настроен — возвращаем ссылку напрямую (dev/demo режим)
  if (!process.env.RESEND_API_KEY) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const link = `${appUrl}/api/auth/verify?token=${token}`;
    console.log(`[auth/request] dev mode, magic link: ${link}`);
    return NextResponse.json({ ok: true, devLink: link });
  }

  try {
    await sendMagicLink(email, token);
  } catch (err) {
    console.error("[auth/request] sendMagicLink failed:", err);
    // Fallback: возвращаем ссылку напрямую чтобы не блокировать вход
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const link = `${appUrl}/api/auth/verify?token=${token}`;
    return NextResponse.json({ ok: true, devLink: link });
  }

  return NextResponse.json({ ok: true });
}
