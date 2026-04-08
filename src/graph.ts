import { ChatAnthropic } from "@langchain/anthropic";
import type { RunnableConfig } from "@langchain/core/runnables";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import {
  END,
  MemorySaver,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { SYSTEM_PROMPT_V1, SYSTEM_PROMPT_V2 } from "./prompts";
import { formatProfileBlock, loadProfile } from "./profile-store";
import { searchExercisesOrResources, updateClientProfile } from "./tools";

const AgentState = new StateSchema({
  messages: MessagesValue,
});

function createModel(tools: StructuredToolInterface[]) {
  const modelName =
    process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
  const llm = new ChatAnthropic({
    model: modelName,
    temperature: 0,
  });
  return llm.bindTools(tools);
}

function buildToolsByName(tools: StructuredToolInterface[]) {
  return Object.fromEntries(tools.map((t) => [t.name, t])) as Record<
    string,
    StructuredToolInterface
  >;
}

export function buildGraphBasic() {
  const tools = [searchExercisesOrResources];
  const toolsByName = buildToolsByName(tools);
  const modelWithTools = createModel(tools);

  const llmCall = async (state: { messages: BaseMessage[] }) => {
    const response = await modelWithTools.invoke([
      new SystemMessage(SYSTEM_PROMPT_V1),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  const toolNode = async (state: { messages: BaseMessage[] }) => {
    const lastMessage = state.messages.at(-1);
    if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
      return { messages: [] };
    }
    const result: BaseMessage[] = [];
    for (const toolCall of lastMessage.tool_calls ?? []) {
      const t = toolsByName[toolCall.name];
      if (!t) continue;
      const observation = await t.invoke(toolCall);
      result.push(observation);
    }
    return { messages: result };
  };

  const shouldContinue = (state: { messages: BaseMessage[] }) => {
    const lastMessage = state.messages.at(-1);
    if (!lastMessage || !AIMessage.isInstance(lastMessage)) return END;
    if (lastMessage.tool_calls?.length) return "toolNode";
    return END;
  };

  return new StateGraph(AgentState)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", toolNode)
    .addEdge(START, "llmCall")
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llmCall")
    .compile();
}

/** Граф с краткосрочной памятью (checkpointer + thread_id). */
export function buildGraphWithMemory() {
  const checkpointer = new MemorySaver();
  const tools = [searchExercisesOrResources];
  const toolsByName = buildToolsByName(tools);
  const modelWithTools = createModel(tools);

  const llmCall = async (state: { messages: BaseMessage[] }) => {
    const response = await modelWithTools.invoke([
      new SystemMessage(SYSTEM_PROMPT_V1),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  const toolNode = async (state: { messages: BaseMessage[] }) => {
    const lastMessage = state.messages.at(-1);
    if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
      return { messages: [] };
    }
    const result: BaseMessage[] = [];
    for (const toolCall of lastMessage.tool_calls ?? []) {
      const t = toolsByName[toolCall.name];
      if (!t) continue;
      result.push(await t.invoke(toolCall));
    }
    return { messages: result };
  };

  const shouldContinue = (state: { messages: BaseMessage[] }) => {
    const lastMessage = state.messages.at(-1);
    if (!lastMessage || !AIMessage.isInstance(lastMessage)) return END;
    if (lastMessage.tool_calls?.length) return "toolNode";
    return END;
  };

  return new StateGraph(AgentState)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", toolNode)
    .addEdge(START, "llmCall")
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llmCall")
    .compile({ checkpointer });
}

/** Профиль в system prompt + инструмент обновления профиля. */
export function buildGraphWithProfile() {
  const checkpointer = new MemorySaver();
  const tools = [searchExercisesOrResources, updateClientProfile];
  const toolsByName = buildToolsByName(tools);
  const modelWithTools = createModel(tools);

  const llmCall = async (state: { messages: BaseMessage[] }) => {
    const profile = await loadProfile();
    const system =
      SYSTEM_PROMPT_V2 + formatProfileBlock(profile);
    const response = await modelWithTools.invoke([
      new SystemMessage(system),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  const toolNode = async (state: { messages: BaseMessage[] }) => {
    const lastMessage = state.messages.at(-1);
    if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
      return { messages: [] };
    }
    const result: BaseMessage[] = [];
    for (const toolCall of lastMessage.tool_calls ?? []) {
      const t = toolsByName[toolCall.name];
      if (!t) continue;
      result.push(await t.invoke(toolCall));
    }
    return { messages: result };
  };

  const shouldContinue = (state: { messages: BaseMessage[] }) => {
    const lastMessage = state.messages.at(-1);
    if (!lastMessage || !AIMessage.isInstance(lastMessage)) return END;
    if (lastMessage.tool_calls?.length) return "toolNode";
    return END;
  };

  return new StateGraph(AgentState)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", toolNode)
    .addEdge(START, "llmCall")
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llmCall")
    .compile({ checkpointer });
}

export const threadConfig = (threadId: string): RunnableConfig => ({
  configurable: { thread_id: threadId },
});

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

/** Удобство: одна реплика без истории. */
export async function invokeOnce(
  graph: ReturnType<typeof buildGraphBasic>,
  text: string
) {
  const result = await graph.invoke({
    messages: [new HumanMessage(text)],
  });
  return lastAiText(result.messages);
}

export async function invokeThread(
  graph: ReturnType<typeof buildGraphWithMemory>,
  text: string,
  config: RunnableConfig
) {
  const result = await graph.invoke(
    { messages: [new HumanMessage(text)] },
    config
  );
  return lastAiText(result.messages);
}
