import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { ToolMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END } from "@langchain/langgraph";
import type { ExerciseResource } from "./data";
import { exerciseResourceArraySchema } from "./schemas";

const PII_PATTERNS: [RegExp, string][] = [
  [/\b\d{4}\s\d{6}\b/, "[PASSPORT]"],
  [/\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b/, "[EMAIL]"],
  [/\b(?:\d{4}[- ]?){3}\d{4}\b/, "[CARD]"],
  [
    /\b(?:\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/,
    "[PHONE]",
  ],
];

export function maskPii(text: string): string {
  let t = text;
  for (const [re, ph] of PII_PATTERNS) {
    t = t.replace(re, ph);
  }
  return t;
}

export function logMessage(role: string, content: string): void {
  const masked = maskPii(content);
  console.log(`[LOG] ${role}: ${masked.slice(0, 120)}`);
}

export async function isOnTopic(
  classifier: BaseChatModel,
  userMessage: string
): Promise<boolean> {
  const response = await classifier.invoke([
    new SystemMessage(
      "You are a relevance classifier for an educational metacognitive therapy (MCT) support chatbot. " +
        "Respond with exactly 'yes' or 'no'.\n\n" +
        "Is the following message related to emotional wellbeing, stress, anxiety, worry, rumination, " +
        "sleep, attention, metacognition, self-help exercises, or MCT-style topics?"
    ),
    new HumanMessage(userMessage),
  ]);
  const raw = typeof response.content === "string" ? response.content : "";
  const answer = raw.trim().toLowerCase();
  console.log(`[GUARD] is_on_topic → ${answer.slice(0, 20)}`);
  return answer.startsWith("yes");
}

const INJECTION_RE = new RegExp(
  "\\[SYSTEM[:\\s]|ignore\\s+|disregard\\s+|new\\s+instructions?|override\\s+|you\\s+are\\s+now\\s+|forget\\s+|act\\s+as\\s+if",
  "i"
);

/** После узла tools: убрать упражнения с prompt-injection в поле notes (аналог fare_rules). */
export function toolOutputGuard(
  state: { messages: BaseMessage[] }
): Partial<{ messages: BaseMessage[] }> {
  const messages = state.messages;
  const lastMsg = messages.at(-1);
  if (!lastMsg || !ToolMessage.isInstance(lastMsg)) return {};
  if (lastMsg.name !== "search_exercises_or_resources") return {};

  let items: ExerciseResource[];
  try {
    const raw = JSON.parse(String(lastMsg.content)) as unknown;
    const validated = exerciseResourceArraySchema.safeParse(raw);
    if (!validated.success) {
      console.warn("[GUARD] search_exercises_or_resources: ошибка валидации JSON", validated.error);
      return {};
    }
    items = validated.data;
  } catch {
    // Контент не является JSON — инструмент уже вернул текстовое сообщение
    // (например, «По запросу ничего не найдено»). Пропускаем без изменений.
    return {};
  }

  const clean: ExerciseResource[] = [];
  for (const ex of items) {
    const notes = ex.notes ?? "";
    if (INJECTION_RE.test(notes)) {
      console.log(
        `[GUARD] ⚠️  Exercise ${ex.exercise_id} dropped: injection detected in notes`
      );
      console.log(`         Snippet: '${notes.slice(0, 80)}...'`);
    } else {
      clean.push(ex);
    }
  }

  if (clean.length === items.length) return {};

  const content =
    clean.length === 0
      ? "По запросу ничего не найдено. Попробуйте другие ключевые слова (тревога, сон, внимание, руминация)."
      : JSON.stringify(clean);

  const cleaned = new ToolMessage({
    content,
    tool_call_id: lastMsg.tool_call_id,
    name: lastMsg.name,
    id: lastMsg.id,
  });
  return { messages: [cleaned] };
}

const BLOCK_TEXT =
  "Я консультант по образовательным темам метакогнитивной терапии и самопомощи. " +
  "Могу обсуждать тревогу, руминацию, внимание, сон и связанные упражнения в образовательном формате. " +
  "Общие вопросы вне этой темы здесь не разбираю.";

/** Первое сообщение: релевантность; лог с маскировкой PII. */
export async function inputGuard(
  state: { messages: BaseMessage[] },
  classifier: BaseChatModel
): Promise<{ messages?: BaseMessage[] }> {
  const lastMsg = state.messages.at(-1);
  const content =
    typeof lastMsg?.content === "string"
      ? lastMsg.content
      : String(lastMsg?.content ?? "");

  logMessage("user", content);

  const hasHistory = state.messages.length > 1;
  if (!hasHistory && !(await isOnTopic(classifier, content))) {
    console.log(`[GUARD] 🚫 Off-topic blocked: '${maskPii(content).slice(0, 60)}'`);
    return { messages: [new AIMessage(BLOCK_TEXT)] };
  }
  return {};
}

export function routeAfterInputGuard(
  state: { messages: BaseMessage[] }
): typeof END | "llmCall" {
  const last = state.messages.at(-1);
  if (last && AIMessage.isInstance(last)) return END;
  return "llmCall";
}

/** Полный граф: после input_guard — координатор веток. */
export function routeAfterInputGuardToCoordinator(
  state: { messages: BaseMessage[] }
): typeof END | "coordinator" {
  const last = state.messages.at(-1);
  if (last && AIMessage.isInstance(last)) return END;
  return "coordinator";
}
