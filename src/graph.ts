import type { RunnableConfig } from "@langchain/core/runnables";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import {
  END,
  MemorySaver,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import { SYSTEM_PROMPT_V1, SYSTEM_PROMPT_V2 } from "./prompts";
import { formatProfileBlock, loadProfile } from "./profile-store";
import { searchExercisesOrResources, updateClientProfile } from "./tools";
import {
  buildToolsByName,
  createChatModel,
  lastAiText,
  makeToolNode,
  shouldContinue,
  threadConfig,
} from "./shared";

const AgentState = new StateSchema({
  messages: MessagesValue,
});

export function buildGraphBasic() {
  const tools = [searchExercisesOrResources];
  const toolsByName = buildToolsByName(tools);
  const modelWithTools = createChatModel().bindTools(tools);

  const llmCall = async (state: { messages: BaseMessage[] }) => {
    const response = await modelWithTools.invoke([
      new SystemMessage(SYSTEM_PROMPT_V1),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  return new StateGraph(AgentState)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", makeToolNode(toolsByName))
    .addEdge(START, "llmCall")
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llmCall")
    .compile();
}

export function buildGraphWithMemory() {
  const checkpointer = new MemorySaver();
  const tools = [searchExercisesOrResources];
  const toolsByName = buildToolsByName(tools);
  const modelWithTools = createChatModel().bindTools(tools);

  const llmCall = async (state: { messages: BaseMessage[] }) => {
    const response = await modelWithTools.invoke([
      new SystemMessage(SYSTEM_PROMPT_V1),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  return new StateGraph(AgentState)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", makeToolNode(toolsByName))
    .addEdge(START, "llmCall")
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llmCall")
    .compile({ checkpointer });
}

export function buildGraphWithProfile() {
  const checkpointer = new MemorySaver();
  const tools = [searchExercisesOrResources, updateClientProfile];
  const toolsByName = buildToolsByName(tools);
  const modelWithTools = createChatModel().bindTools(tools);

  const llmCall = async (state: { messages: BaseMessage[] }) => {
    const profile = await loadProfile();
    const system = SYSTEM_PROMPT_V2 + formatProfileBlock(profile);
    const response = await modelWithTools.invoke([
      new SystemMessage(system),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  return new StateGraph(AgentState)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", makeToolNode(toolsByName))
    .addEdge(START, "llmCall")
    .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llmCall")
    .compile({ checkpointer });
}

export { lastAiText, threadConfig };

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
