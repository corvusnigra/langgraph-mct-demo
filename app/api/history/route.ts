import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { getFullGraph } from "@/src/server/full-graph";
import { lastAiText } from "@/src/seminar-graphs";
import { getUser } from "@/src/server/auth";
import { getPgPool } from "@/src/server/pg-pool";

export const runtime = "nodejs";

async function threadBelongsToUser(threadId: string, userId: string): Promise<boolean> {
  const pool = getPgPool();
  if (!pool) return true; // dev без БД — не блокируем
  const { rows } = await pool.query(
    `SELECT 1 FROM mct_chat_sessions WHERE thread_id = $1 AND user_id = $2`,
    [threadId, userId]
  );
  return rows.length > 0;
}

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");
  if (!threadId) {
    return NextResponse.json({ error: "Нужен threadId" }, { status: 400 });
  }

  const user = await getUser(req);
  if (!user) return NextResponse.json({ messages: [] });

  const owns = await threadBelongsToUser(threadId, user.id);
  if (!owns) {
    // Тред не принадлежит пользователю — возвращаем пустую историю
    return NextResponse.json({ messages: [], foreign: true });
  }

  let graph;
  try {
    graph = await getFullGraph();
  } catch {
    return NextResponse.json({ messages: [] });
  }

  const config = { configurable: { thread_id: threadId } };
  let state;
  try {
    state = await graph.getState(config);
  } catch {
    return NextResponse.json({ messages: [] });
  }

  const allMessages = (state.values as { messages?: unknown[] }).messages ?? [];

  const result: { role: "user" | "assistant"; text: string }[] = [];
  for (const msg of allMessages) {
    if (HumanMessage.isInstance(msg)) {
      const text = typeof msg.content === "string" ? msg.content : "";
      if (text) result.push({ role: "user", text });
    } else if (AIMessage.isInstance(msg) && !msg.tool_calls?.length) {
      const text = lastAiText([msg]);
      if (text) result.push({ role: "assistant", text });
    }
  }

  return NextResponse.json({ messages: result });
}
