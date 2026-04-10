import { NextResponse } from "next/server";
import { createMagicToken } from "@/src/server/auth";
import { sendMagicLink } from "@/src/server/email";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Укажите корректный email" }, { status: 400 });
  }

  try {
    const token = await createMagicToken(email);
    await sendMagicLink(email, token);
  } catch (err) {
    console.error("[auth/request]", err);
    return NextResponse.json({ error: "Ошибка отправки письма" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
