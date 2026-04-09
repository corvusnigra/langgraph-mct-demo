import { NextResponse } from "next/server";
import { HumanMessage } from "@langchain/core/messages";
import { INTERRUPT, isInterrupted } from "@langchain/langgraph";
import { getFullGraph } from "@/src/server/full-graph";
import { lastAiText } from "@/src/seminar-graphs";

export const runtime = "nodejs";

/** Лимит выполнения на Vercel (сек.); на Hobby фактический максимум может быть ниже — см. панель Vercel. */
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Задайте ANTHROPIC_API_KEY в .env" },
      { status: 500 }
    );
  }

  let body: { threadId: string; message: string };
  try {
    body = (await req.json()) as { threadId: string; message: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { threadId, message } = body;
  if (!threadId || typeof message !== "string") {
    return NextResponse.json(
      { error: "Нужны threadId и message" },
      { status: 400 }
    );
  }

  let graph;
  try {
    graph = await getFullGraph();
  } catch (e) {
    console.error("[api/chat] getFullGraph", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Не удалось инициализировать граф (проверьте DATABASE_URL и логи).",
      },
      { status: 500 }
    );
  }

  const config = { configurable: { thread_id: threadId } };

  let result;
  try {
    result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );
  } catch (e) {
    console.error("[api/chat] invoke", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Ошибка выполнения графа (таймаут, LLM, сеть).",
      },
      { status: 500 }
    );
  }

  if (isInterrupted(result)) {
    const raw = result[INTERRUPT];
    const first = Array.isArray(raw) && raw.length > 0 ? raw[0] : undefined;
    const payload =
      first != null && typeof first === "object" && "value" in first
        ? (first as { value: unknown }).value
        : first;
    return NextResponse.json({
      reply: "",
      interrupted: true,
      interruptPayload: payload ?? null,
    });
  }

  return NextResponse.json({
    reply: lastAiText(result.messages),
    interrupted: false,
  });
}
