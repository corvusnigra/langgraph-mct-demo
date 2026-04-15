import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { RunnableConfig } from "@langchain/core/runnables";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { END } from "@langchain/langgraph";

export const DEFAULT_MODEL = "claude-sonnet-4-20250514";
/** Лёгкая модель для классификации и роутинга (guard, coordinator) */
const DEFAULT_FAST_MODEL = "claude-haiku-4-5-20251001";

export const MODEL_CATALOG = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "anthropic" as const },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "anthropic" as const },
  { id: "glm-4-plus", label: "GLM-4 Plus", provider: "glm" as const },
  { id: "glm-4-flash", label: "GLM-4 Flash", provider: "glm" as const },
] as const;

export type ModelEntry = (typeof MODEL_CATALOG)[number];

/** Список моделей, для которых задан API-ключ */
export function availableModels(): ModelEntry[] {
  return (MODEL_CATALOG as readonly ModelEntry[]).filter((m) => {
    if (m.provider === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
    if (m.provider === "glm") return !!process.env.GLM_API_KEY;
    return false;
  });
}

/** Создаёт LangChain-модель по id — поддерживает Anthropic и GLM */
export function createModelById(modelId: string): ChatAnthropic | ChatOpenAI {
  if (modelId.startsWith("glm-")) {
    return new ChatOpenAI({
      model: modelId,
      apiKey: process.env.GLM_API_KEY ?? "",
      configuration: { baseURL: "https://open.bigmodel.cn/api/paas/v4" },
      temperature: 0,
    });
  }
  return new ChatAnthropic({ model: modelId, temperature: 0 });
}

export function createChatModel(): ChatAnthropic {
  const modelName = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  return new ChatAnthropic({ model: modelName, temperature: 0 });
}

/** Guard / классификатор on-topic — быстрая дешёвая модель */
export function createGuardModel(): ChatAnthropic {
  const modelName = process.env.GUARD_MODEL ?? DEFAULT_FAST_MODEL;
  return new ChatAnthropic({ model: modelName, temperature: 0 });
}

/** Coordinator structured-output роутинг — быстрая дешёвая модель */
export function createCoordinatorModel(): ChatAnthropic {
  const modelName = process.env.COORDINATOR_MODEL ?? DEFAULT_FAST_MODEL;
  return new ChatAnthropic({ model: modelName, temperature: 0 });
}

/** Critic — оценка качества ответа, нужна хорошая модель */
export function createCriticModel(): ChatAnthropic {
  const modelName = process.env.CRITIC_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  return new ChatAnthropic({ model: modelName, temperature: 0 });
}

export function buildToolsByName(tools: StructuredToolInterface[]) {
  return Object.fromEntries(tools.map((t) => [t.name, t])) as Record<
    string,
    StructuredToolInterface
  >;
}

export function lastAiText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (AIMessage.isInstance(m)) {
      const c = m.content;
      return typeof c === "string" ? c : JSON.stringify(c);
    }
  }
  return "";
}

/**
 * Последний AI-ответ БЕЗ tool_calls — финальный текст для пользователя.
 * Используется critic'ом: при поиске через lastAiText мог попасть tool_call AIMessage без текста.
 */
export function lastAiTextFinal(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (AIMessage.isInstance(m) && !(m.tool_calls?.length)) {
      const c = m.content;
      return typeof c === "string" ? c : JSON.stringify(c);
    }
  }
  return "";
}

export function threadConfig(threadId: string): RunnableConfig {
  return { configurable: { thread_id: threadId } };
}

export function makeToolNode(
  toolsByName: Record<string, StructuredToolInterface>
) {
  return async (state: { messages: BaseMessage[] }) => {
    const lastMessage = state.messages.at(-1);
    if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
      return { messages: [] };
    }
    const result: BaseMessage[] = [];
    for (const toolCall of lastMessage.tool_calls ?? []) {
      const t = toolsByName[toolCall.name];
      if (!t) {
        console.warn(`[TOOL] неизвестный инструмент: ${toolCall.name}`);
        result.push(
          new ToolMessage({
            content: `Ошибка: инструмент «${toolCall.name}» не найден.`,
            tool_call_id: toolCall.id ?? "",
          })
        );
        continue;
      }
      result.push(await t.invoke(toolCall));
    }
    return { messages: result };
  };
}

export function shouldContinue(state: { messages: BaseMessage[] }): typeof END | "toolNode" {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) return END;
  if (lastMessage.tool_calls?.length) return "toolNode";
  return END;
}
