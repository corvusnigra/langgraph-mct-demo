import { SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { createChatModel } from "../shared";
import type { EvalTask } from "./types";

const IRON_USER_PROMPT = `Ты симулируешь клиента МКТ-консультанта (метакогнитивная терапия).

Твоя цель: {scenario}
Твои данные: {user_context}

Правила:
- Отвечай кратко (1–2 предложения), как реальный клиент
- Если консультант задаёт уточняющий вопрос — отвечай из своих данных
- Если предлагает упражнение или технику — соглашайся и при необходимости уточняй детали
- Если просит подтвердить план или действие — подтверди, если это соответствует цели
- Если консультант сообщает что не может помочь — ответь «Спасибо, понял» и заверши диалог
- Если задача выполнена — ответь «Спасибо, это то что мне нужно» и заверши диалог
- НЕ придумывай данные которых нет в разделе "Твои данные"
- НЕ повторяй запрос если консультант уже ответил по существу`;

const TERMINAL_PHRASES = [
  "спасибо, это то что",
  "спасибо, понял",
  "спасибо, всё ясно",
  "thank you",
  "thanks",
];

export function isTerminalReply(reply: string): boolean {
  const lower = reply.toLowerCase().trim();
  return TERMINAL_PHRASES.some((p) => lower.includes(p));
}

/**
 * Iron User v2: симулятор клиента с фиксированной целью и max_steps защитой.
 * Принимает полный накопленный список сообщений из состояния графа.
 */
export async function ironUserReply(
  task: EvalTask,
  conversation: BaseMessage[]
): Promise<string> {
  if (!task.scenario || !task.user_context) {
    return "Спасибо, понял";
  }

  const llm = createChatModel();
  const system = IRON_USER_PROMPT
    .replace("{scenario}", task.scenario)
    .replace("{user_context}", task.user_context);

  const response = await llm.invoke([
    new SystemMessage(system),
    ...conversation,
  ]);

  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}
