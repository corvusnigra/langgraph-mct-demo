import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import { getFullGraph } from "@/src/server/full-graph";
import { lastAiText } from "@/src/seminar-graphs";
import { getUser } from "@/src/server/auth";
import { requestContext } from "@/src/server/request-context";
import { getPgPool } from "@/src/server/pg-pool";

export const runtime = "nodejs";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Задайте ANTHROPIC_API_KEY в .env" },
      { status: 500 }
    );
  }

  const user = await getUser(req);

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

  // Resolve sessionId from threadId if user is authenticated
  let sessionId: string | undefined;
  if (user) {
    const pool = getPgPool();
    if (pool) {
      const { rows } = await pool
        .query<{ id: string }>(
          `SELECT id FROM mct_chat_sessions WHERE thread_id = $1 AND user_id = $2 LIMIT 1`,
          [threadId, user.id]
        )
        .catch(() => ({ rows: [] as { id: string }[] }));
      sessionId = rows[0]?.id;
    }
  }

  const config = { configurable: { thread_id: threadId } };

  let result;
  try {
    result = await requestContext.run(
      { userId: user?.id, sessionId },
      () =>
        graph.invoke(
          // @ts-expect-error LangGraph Command type несовместим с state generics
          new Command({ resume }),
          config
        )
    );
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
  });
}
