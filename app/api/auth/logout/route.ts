import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { deleteSession, SESSION_COOKIE } from "@/src/server/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  if (sessionToken) {
    await deleteSession(sessionToken).catch((err) =>
      console.error("[auth/logout]", err)
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return res;
}
