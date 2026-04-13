import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "mct_session";
const PUBLIC_PATHS = ["/login", "/api/auth/request", "/api/auth/verify"];

/** UUID v4 regex — минимальная проверка формата токена на Edge без обращения к БД. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  const session = req.cookies.get(SESSION_COOKIE)?.value;

  // Проверяем наличие cookie и соответствие UUID-формату.
  // Полная проверка актуальности сессии в БД выполняется в каждом API-route через getUser().
  if (!session || !UUID_RE.test(session)) {
    const res = NextResponse.redirect(new URL("/login", req.url));
    // Сбросить невалидную cookie
    if (session) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
