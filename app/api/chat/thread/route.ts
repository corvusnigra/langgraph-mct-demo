import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUser } from "@/src/server/auth";
import { getOrCreateThread, createNewThread } from "@/src/server/session-db";

export const runtime = "nodejs";

/** GET /api/chat/thread?modality=mct|act
 *  Возвращает последний thread_id пользователя для данной модальности (или создаёт новый). */
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const modality = (req.nextUrl.searchParams.get("modality") ?? "mct") as "mct" | "act";
  const threadId = await getOrCreateThread(user.id, modality);
  return NextResponse.json({ threadId });
}

/** POST /api/chat/thread { modality }
 *  Создаёт новый thread и возвращает его id. */
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  let body: { modality?: "mct" | "act" } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const modality = body.modality ?? "mct";
  const threadId = await createNewThread(user.id, modality);
  return NextResponse.json({ threadId });
}
