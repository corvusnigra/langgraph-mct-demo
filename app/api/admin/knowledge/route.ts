import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUser } from "@/src/server/auth";
import { listSources, deleteSource } from "@/src/embeddings/vector-store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user || (user.role !== "therapist" && user.role !== "admin")) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }
  const sources = await listSources();
  return NextResponse.json({ sources });
}

export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user || (user.role !== "therapist" && user.role !== "admin")) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }
  const { id } = (await req.json()) as { id: string };
  await deleteSource(id);
  return NextResponse.json({ ok: true });
}
