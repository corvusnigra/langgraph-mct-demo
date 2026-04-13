import { ChatAnthropic } from "@langchain/anthropic";
import type { RunnableConfig } from "@langchain/core/runnables";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { END } from "@langchain/langgraph";

export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export function createChatModel(): ChatAnthropic {
  const modelName = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
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
