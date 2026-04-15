import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUser } from "@/src/server/auth";
import { getTherapistAnalytics } from "@/src/server/session-db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (user.role !== "therapist" && user.role !== "admin") {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  const analytics = await getTherapistAnalytics(user.id, user.role === "admin");
  return NextResponse.json(analytics);
}
