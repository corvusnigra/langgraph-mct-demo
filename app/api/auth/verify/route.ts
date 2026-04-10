import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyMagicToken, createSession, SESSION_COOKIE } from "@/src/server/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", req.url));
  }

  let user;
  try {
    user = await verifyMagicToken(token);
  } catch (err) {
    console.error("[auth/verify]", err);
    return NextResponse.redirect(new URL("/login?error=server_error", req.url));
  }

  if (!user) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", req.url));
  }

  const sessionToken = await createSession(user.id);

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 дней
    secure: process.env.NODE_ENV === "production",
  });

  return res;
}
