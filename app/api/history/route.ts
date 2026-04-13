import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { getFullGraph } from "@/src/server/full-graph";
import { lastAiText } from "@/src/seminar-graphs";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");
  if (!threadId) {
    return NextResponse.json({ error: "Нужен threadId" }, { status: 400 });
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
