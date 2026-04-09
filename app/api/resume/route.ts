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

  let graph;
  try {
    graph = await getFullGraph();
  } catch (e) {
    console.error("[api/resume] getFullGraph", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Не удалось инициализировать граф.",
      },
      { status: 500 }
    );
  }

  const config = { configurable: { thread_id: threadId } };

  let result;
  try {
    result = await graph.invoke(new Command({ resume }), config);
  } catch (e) {
    console.error("[api/resume] invoke", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Ошибка выполнения графа.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    reply: lastAiText(result.messages),
  });
}
