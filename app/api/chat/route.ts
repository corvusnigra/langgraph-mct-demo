import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { HumanMessage } from "@langchain/core/messages";
import { INTERRUPT, isInterrupted } from "@langchain/langgraph";
import { getFullGraph } from "@/src/server/full-graph";
import { lastAiText } from "@/src/seminar-graphs";
import { getUser } from "@/src/server/auth";
import { createChatSession, getRecentSessions, closeChatSession } from "@/src/server/session-db";
import { requestContext } from "@/src/server/request-context";
import { sendSessionFollowUp } from "@/src/server/email";

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

  let body: { threadId: string; message: string; moodBefore?: number; modality?: "mct" | "act" };
  try {
    body = (await req.json()) as { threadId: string; message: string; moodBefore?: number; modality?: "mct" | "act" };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { threadId, message, moodBefore, modality } = body;
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

  // Create or upsert session record
  let sessionId: string | undefined;
  if (user) {
    sessionId = await createChatSession(user.id, threadId, moodBefore) || undefined;
  }

  const config = { configurable: { thread_id: threadId } };

  let result;
  try {
    result = await requestContext.run(
      { userId: user?.id, sessionId, modality: modality ?? "mct" },
      () => graph.invoke({ messages: [new HumanMessage(message)] }, config)
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

  // Phase 3: close session + send follow-up email (fire-and-forget)
  if (user && sessionId) {
    closeChatSession(threadId).catch(() => null);
    getRecentSessions(user.id, 1)
      .then(([session]) => {
        if (session?.exercises.length) {
          sendSessionFollowUp(user.email, { exercises: session.exercises }).catch(
            () => null
          );
        }
      })
      .catch(() => null);
  }

  return NextResponse.json({
    reply: lastAiText(result.messages),
    interrupted: false,
  });
}
