import { ChatAnthropic } from "@langchain/anthropic";
import type { RunnableConfig } from "@langchain/core/runnables";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  Command,
  END,
  MemorySaver,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import {
  inputGuard,
  routeAfterInputGuard,
  toolOutputGuard,
} from "./guards";
import {
  SYSTEM_PROMPT_V2_RAG,
  SYSTEM_PROMPT_V3,
  SYSTEM_PROMPT_V4,
} from "./prompts";
import { formatProfileBlock, loadProfile } from "./profile-store";
import { lookupMctReference } from "./rag-tools";
import { searchExercisesOrResources, updateClientProfile } from "./tools";
import { proposeHomeworkPlan } from "./homework-interrupt-tool";

const AgentState = new StateSchema({
  messages: MessagesValue,
});

function bindTools(model: ChatAnthropic, tools: StructuredToolInterface[]) {
  return model.bindTools(tools);
}

function createChatModel(): ChatAnthropic {
  const modelName =
    process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
  return new ChatAnthropic({
    model: modelName,
    temperature: 0,
  });
}

function toolsByName(tools: StructuredToolInterface[]) {
  return Object.fromEntries(tools.map((t) => [t.name, t])) as Record<
    string,
    StructuredToolInterface
  >;
}

type SystemFn = () => Promise<string>;

function buildReactLoop(
  getSystem: SystemFn,
  tools: StructuredToolInterface[],
  model: ChatAnthropic
) {
  const map = toolsByName(tools);
  const modelWithTools = bindTools(model, tools);

  const llmCall = async (state: { messages: BaseMessage[] }) => {
    const system = await getSystem();
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
      const t = map[toolCall.name];
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

  return { llmCall, toolNode, shouldContinue };
}

/** RAG: прямой запрос в lookup_mct_reference. */
export function buildGraphRag() {
  const checkpointer = new MemorySaver();
  const tools = [searchExercisesOrResources, lookupMctReference, updateClientProfile];
  const model = createChatModel();
  const { llmCall, toolNode, shouldContinue } = buildReactLoop(
    async () => SYSTEM_PROMPT_V2_RAG + formatProfileBlock(await loadProfile()),
    tools,
    model
  );

  return new StateGraph(AgentState)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", toolNode)
    .addEdge(START, "llmCall")
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llmCall")
    .compile({ checkpointer });
}

/** HyDE: инструкции в SYSTEM_PROMPT_V3. */
export function buildGraphHyde() {
  const checkpointer = new MemorySaver();
  const tools = [searchExercisesOrResources, lookupMctReference, updateClientProfile];
  const model = createChatModel();
  const { llmCall, toolNode, shouldContinue } = buildReactLoop(
    async () => SYSTEM_PROMPT_V3 + formatProfileBlock(await loadProfile()),
    tools,
    model
  );

  return new StateGraph(AgentState)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", toolNode)
    .addEdge(START, "llmCall")
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llmCall")
    .compile({ checkpointer });
}

/** input_guard + tool_output_guard + HyDE-промпт. */
export function buildGuardedGraph() {
  const checkpointer = new MemorySaver();
  const tools = [searchExercisesOrResources, lookupMctReference, updateClientProfile];
  const model = createChatModel();
  const classifier = createChatModel();
  const { llmCall, toolNode, shouldContinue } = buildReactLoop(
    async () => SYSTEM_PROMPT_V3 + formatProfileBlock(await loadProfile()),
    tools,
    model
  );

  const inputGuardNode = async (state: { messages: BaseMessage[] }) => {
    return inputGuard(state, classifier);
  };

  const toolGuardNode = (state: { messages: BaseMessage[] }) =>
    toolOutputGuard(state);

  return new StateGraph(AgentState)
    .addNode("input_guard", inputGuardNode)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", toolNode)
    .addNode("tool_output_guard", toolGuardNode)
    .addEdge(START, "input_guard")
    .addConditionalEdges("input_guard", routeAfterInputGuard, ["llmCall", END])
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "tool_output_guard")
    .addEdge("tool_output_guard", "llmCall")
    .compile({ checkpointer });
}

/** Полный граф: guards + propose_homework_plan (interrupt). */
export function buildFullGraph() {
  const checkpointer = new MemorySaver();
  const tools = [
    searchExercisesOrResources,
    lookupMctReference,
    updateClientProfile,
    proposeHomeworkPlan,
  ];
  const model = createChatModel();
  const classifier = createChatModel();
  const { llmCall, toolNode, shouldContinue } = buildReactLoop(
    async () => SYSTEM_PROMPT_V4 + formatProfileBlock(await loadProfile()),
    tools,
    model
  );

  const inputGuardNode = async (state: { messages: BaseMessage[] }) => {
    return inputGuard(state, classifier);
  };

  const toolGuardNode = (state: { messages: BaseMessage[] }) =>
    toolOutputGuard(state);

  return new StateGraph(AgentState)
    .addNode("input_guard", inputGuardNode)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", toolNode)
    .addNode("tool_output_guard", toolGuardNode)
    .addEdge(START, "input_guard")
    .addConditionalEdges("input_guard", routeAfterInputGuard, ["llmCall", END])
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "tool_output_guard")
    .addEdge("tool_output_guard", "llmCall")
    .compile({ checkpointer });
}

export function threadCfg(threadId: string): RunnableConfig {
  return { configurable: { thread_id: threadId } };
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

export { createChatModel };
export { Command };
