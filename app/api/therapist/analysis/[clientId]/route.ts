import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getUser } from "@/src/server/auth";
import { getClientThreadIds } from "@/src/server/session-db";
import { getPgPool } from "@/src/server/pg-pool";
import { getFullGraph } from "@/src/server/full-graph";
import { lastAiText } from "@/src/seminar-graphs";
import { createChatModel, createModelById } from "@/src/shared";

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
  "risk_notes": "любые настораживающие моменты или null если их нет",
  "act_hexaflex": {
    "acceptance": 5,
    "defusion": 5,
    "present_moment": 5,
    "self_as_context": 5,
    "values": 5,
    "committed_action": 5
  },
  "mct_profile": {
    "detached_mindfulness": 5,
    "attentional_flexibility": 5,
    "metacognitive_awareness": 5,
    "rumination_control": 5,
    "adaptive_strategies": 5,
    "emotional_regulation": 5
  }
}

Поле act_hexaflex — оценки психологической гибкости клиента по модели ACT (0-10):
- acceptance: готовность принимать трудные мысли и чувства без борьбы с ними
- defusion: способность замечать мысли как мысли, а не буквальную реальность
- present_moment: гибкое внимание к текущему моменту (не руминация/тревога о будущем)
- self_as_context: осознание наблюдающего "я", отделённого от содержания мыслей
- values: ясность и осознанность жизненных ценностей и направлений
- committed_action: конкретные шаги к ценностям несмотря на дискомфорт

Поле mct_profile — оценки по профилю метакогнитивной терапии (МКТ) клиента (0-10, выше = лучше):
- detached_mindfulness: способность наблюдать мысли отстранённо, не вовлекаясь в них
- attentional_flexibility: гибкость внимания, способность переключать фокус по желанию
- metacognitive_awareness: осознанность собственного мышления как процесса (мета-уровень)
- rumination_control: низкий уровень руминации и беспокойства (10 = почти нет руминации)
- adaptive_strategies: использование адаптивных стратегий вместо избегания/подавления мыслей
- emotional_regulation: способность регулировать эмоции через изменение мета-убеждений

Если данных недостаточно для оценки — ставь 3-5 (нейтральная середина).`;

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
  if (user.role !== "admin") {
    const allowed = await isClientOfTherapist(user.id, clientId);
    if (!allowed) {
      return NextResponse.json({ error: "Клиент не прикреплён" }, { status: 403 });
    }
  }

  const pool = getPgPool();
  if (pool) {
    const { rows } = await pool.query(
      `SELECT analysis, created_at FROM mct_client_analyses WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [clientId]
    );
    if (rows.length > 0) {
      return NextResponse.json({ analysis: rows[0].analysis, created_at: rows[0].created_at });
    }
  }

  return NextResponse.json({ analysis: null, created_at: null });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (user.role !== "therapist" && user.role !== "admin") {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  const { clientId } = await params;

  // Admin видит всех клиентов без привязки; therapist — только своих
  if (user.role !== "admin") {
    const allowed = await isClientOfTherapist(user.id, clientId);
    if (!allowed) {
      return NextResponse.json({ error: "Клиент не прикреплён" }, { status: 403 });
    }
  }

  let modelId: string | undefined;
  try {
    const body = (await req.json()) as { model?: string };
    modelId = body.model;
  } catch { /* body может быть пустым */ }

  const transcript = await buildTranscript(clientId);
  if (!transcript) {
    return NextResponse.json({ error: "Нет данных сессий для анализа" }, { status: 404 });
  }

  const model = modelId ? createModelById(modelId) : createChatModel();
  let response;
  try {
    response = await model.invoke([
      new SystemMessage(ANALYSIS_SYSTEM),
      new HumanMessage(`Проанализируй следующую переписку клиента:\n\n${transcript.slice(0, 24_000)}`),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[analysis] model.invoke failed:", msg);
    return NextResponse.json({ error: `Ошибка модели: ${msg}` }, { status: 500 });
  }

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

  const pool = getPgPool();
  if (pool) {
    await pool.query(
      `INSERT INTO mct_client_analyses (client_id, analysis) VALUES ($1, $2)`,
      [clientId, JSON.stringify(analysis)]
    );
  }

  return NextResponse.json({ analysis, created_at: new Date().toISOString() });
}
