import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUser } from "@/src/server/auth";
import { getClientDetail } from "@/src/server/session-db";
import { getPgPool } from "@/src/server/pg-pool";

export const runtime = "nodejs";

async function isClientOfTherapist(therapistId: string, clientId: string): Promise<boolean> {
  const pool = getPgPool();
  if (!pool) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM mct_therapist_clients WHERE therapist_id = $1 AND client_id = $2`,
    [therapistId, clientId]
  );
  return rows.length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (user.role !== "therapist" && user.role !== "admin") {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  const { clientId } = await params;

  const allowed = await isClientOfTherapist(user.id, clientId);
  if (!allowed) {
    return NextResponse.json({ error: "Клиент не прикреплён" }, { status: 403 });
  }

  const detail = await getClientDetail(user.id, clientId);
  if (!detail) {
    return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
