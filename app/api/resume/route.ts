import { NextResponse } from "next/server";
import { Command } from "@langchain/langgraph";
import { getFullGraph } from "@/src/server/full-graph";
import { lastAiText } from "@/src/seminar-graphs";

export const runtime = "nodejs";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Задайте ANTHROPIC_API_KEY в .env" },
      { status: 500 }
    );
  }

  let body: { threadId: string; resume: string };
  try {
    body = (await req.json()) as { threadId: string; resume: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { threadId, resume } = body;
  if (!threadId || resume === undefined) {
    return NextResponse.json(
      { error: "Нужны threadId и resume" },
      { status: 400 }
    );
  }

  const graph = await getFullGraph();
  const config = { configurable: { thread_id: threadId } };

  const result = await graph.invoke(new Command({ resume }), config);

  return NextResponse.json({
    reply: lastAiText(result.messages),
  });
}
