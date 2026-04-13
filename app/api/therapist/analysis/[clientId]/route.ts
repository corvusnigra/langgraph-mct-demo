import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getUser } from "@/src/server/auth";
import { getClientThreadIds } from "@/src/server/session-db";
import { getPgPool } from "@/src/server/pg-pool";
import { getFullGraph } from "@/src/server/full-graph";
import { lastAiText } from "@/src/seminar-graphs";
import { createChatModel } from "@/src/shared";

export const runtime = "nodejs";
export const maxDuration = 60;

const ANALYSIS_SYSTEM = `Ты — клинический супервизор, помогающий терапевтам понять своих клиентов.
Тебе передаётся транскрипт переписки клиента с образовательным чат-ботом по МКТ/ACT.
Проанализируй переписку и верни структурированный JSON-анализ.

ВАЖНО: это образовательный инструмент, не клинический диагноз. Пиши по-русски.

Верни ТОЛЬКО валидный JSON без markdown-обёртки:
{
  "main_themes": ["список 2-5 ключевых тем/проблем клиента"],
  "emotional_patterns": "описание паттернов — как клиент относится к своим мыслям и чувствам (2-4 предложения)",
  "engagement": "как клиент взаимодействовал с упражнениями и техниками (1-3 предложения)",
  "key_insights": ["список 2-4 важных наблюдений из переписки"],
  "therapist_recommendations": ["список 3-5 конкретных рекомендаций для терапевта"],
  "suggested_exercises": ["список 2-3 упражнений/техник МКТ или ACT, подходящих этому клиенту"],
  "risk_notes": "любые настораживающие моменты или null если их нет"
}`;

async function isClientOfTherapist(
  therapistId: string,
  clientId: string
): Promise<boolean> {
  const pool = getPgPool();
  if (!pool) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM mct_therapist_clients
     WHERE therapist_id = $1 AND client_id = $2`,
    [therapistId, clientId]
  );
  return rows.length > 0;
}

async function buildTranscript(clientId: string): Promise<string> {
  const threadIds = await getClientThreadIds(clientId);
  if (threadIds.length === 0) return "";

  let graph;
  try {
    graph = await getFullGraph();
  } catch {
    return "";
  }

  const parts: string[] = [];
  for (const threadId of threadIds) {
    try {
      const state = await graph.getState({ configurable: { thread_id: threadId } });
      const messages = (state.values as { messages?: unknown[] }).messages ?? [];
      const lines: string[] = [];
      for (const msg of messages) {
        if (HumanMessage.isInstance(msg)) {
          const text = typeof msg.content === "string" ? msg.content : "";
          if (text) lines.push(`Клиент: ${text}`);
        } else if (AIMessage.isInstance(msg) && !msg.tool_calls?.length) {
          const text = lastAiText([msg]);
          if (text) lines.push(`Ассистент: ${text}`);
        }
      }
      if (lines.length) parts.push(`--- Сессия (thread: ${threadId.slice(0, 8)}) ---\n${lines.join("\n")}`);
    } catch {
      // skip failed threads
    }
  }

  return parts.join("\n\n");
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

  const transcript = await buildTranscript(clientId);
  if (!transcript) {
    return NextResponse.json({ error: "Нет данных сессий для анализа" }, { status: 404 });
  }

  const model = createChatModel();
  const response = await model.invoke([
    new SystemMessage(ANALYSIS_SYSTEM),
    new HumanMessage(`Проанализируй следующую переписку клиента:\n\n${transcript.slice(0, 24_000)}`),
  ]);

  const raw = typeof response.content === "string" ? response.content : "";
  let analysis: unknown;
  try {
    analysis = JSON.parse(raw);
  } catch {
    // Claude иногда оборачивает в ```json — чистим
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      analysis = JSON.parse(match?.[1] ?? raw);
    } catch {
      return NextResponse.json({ error: "Не удалось разобрать ответ модели" }, { status: 500 });
    }
  }

  return NextResponse.json({ analysis });
}
