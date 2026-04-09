import { ChatAnthropic } from "@langchain/anthropic";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
  messagesStateReducer,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import {
  inputGuard,
  routeAfterInputGuard,
  routeAfterInputGuardToCoordinator,
  toolOutputGuard,
} from "./guards";
import {
  COORDINATOR_SYSTEM,
  CRITIC_SYSTEM,
  SYSTEM_PROMPT_V2_RAG,
  SYSTEM_PROMPT_V3,
  SYSTEM_PROMPT_V4,
} from "./prompts";
import { formatProfileBlock, loadProfile } from "./profile-store";
import { lookupMctReference } from "./rag-tools";
import { searchExercisesOrResources, updateClientProfile } from "./tools";
import { proposeHomeworkPlan } from "./homework-interrupt-tool";
import {
  coordinatorRoutingSchema,
  toolsForBranch,
  type AgentBranch,
} from "./branching";

const AgentState = new StateSchema({
  messages: MessagesValue,
});

const MAX_CRITIC_REVISIONS = 2;

const FullGraphAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  routing_branch: Annotation<AgentBranch>(),
  critic_round: Annotation<number>(),
  critic_last_verdict: Annotation<"pass" | "revise" | undefined>(),
});

function bindTools(model: ChatAnthropic, tools: StructuredToolInterface[]) {
  return model.bindTools(tools);
}

export function createChatModel(): ChatAnthropic {
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
    const calls = lastMessage.tool_calls ?? [];
    if (calls.length > 1) {
      console.warn(
        `[TAO] несколько tool_calls (${calls.length}), выполняется только первый`
      );
    }
    const toolCall = calls[0];
    if (!toolCall) return { messages: [] };
    const t = map[toolCall.name];
    if (!t) return { messages: [] };
    const msg = await t.invoke(toolCall);
    return { messages: [msg] };
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

const criticVerdictSchema = z.object({
  verdict: z.enum(["pass", "revise"]),
  feedback: z.string().optional(),
});

/** Полный граф: guards + координатор + узкие tools + TAO + критик + interrupt ДЗ. */
export function buildFullGraph(checkpointer?: BaseCheckpointSaver) {
  const cp = checkpointer ?? new MemorySaver();
  const model = createChatModel();
  const classifier = createChatModel();
  const coordinatorModel = createChatModel().withStructuredOutput(
    coordinatorRoutingSchema
  );
  const criticModel = createChatModel().withStructuredOutput(criticVerdictSchema);

  const getBaseSystem = async () =>
    SYSTEM_PROMPT_V4 + formatProfileBlock(await loadProfile());

  const inputGuardNode = async (state: typeof FullGraphAnnotation.State) => {
    return inputGuard(state, classifier);
  };

  const coordinatorNode = async (state: typeof FullGraphAnnotation.State) => {
    const last = state.messages.at(-1);
    if (!HumanMessage.isInstance(last)) {
      return {};
    }
    const out = await coordinatorModel.invoke([
      new SystemMessage(COORDINATOR_SYSTEM),
      last,
    ]);
    console.log(
      `[COORDINATOR] branch=${out.branch}${out.rationale ? ` (${out.rationale})` : ""}`
    );
    const branch = out.branch as AgentBranch;
    return {
      routing_branch: branch,
      critic_round: 0,
      critic_last_verdict: undefined,
    };
  };

  const llmCall = async (state: typeof FullGraphAnnotation.State) => {
    const branch = (state.routing_branch ?? "general") as AgentBranch;
    const tools = toolsForBranch(branch);
    const modelWithTools = bindTools(model, tools);
    const system = await getBaseSystem();
    const response = await modelWithTools.invoke([
      new SystemMessage(system),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  const mapAllTools = toolsByName([
    searchExercisesOrResources,
    lookupMctReference,
    updateClientProfile,
    proposeHomeworkPlan,
  ]);

  const toolNode = async (state: typeof FullGraphAnnotation.State) => {
    const lastMessage = state.messages.at(-1);
    if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
      return { messages: [] };
    }
    const calls = lastMessage.tool_calls ?? [];
    if (calls.length > 1) {
      console.warn(
        `[TAO] несколько tool_calls (${calls.length}), выполняется только первый`
      );
    }
    const toolCall = calls[0];
    if (!toolCall) return { messages: [] };
    const t = mapAllTools[toolCall.name];
    if (!t) {
      console.warn(`[TAO] неизвестный tool: ${toolCall.name}`);
      return { messages: [] };
    }
    const msg = await t.invoke(toolCall);
    return { messages: [msg] };
  };

  const toolGuardNode = (state: typeof FullGraphAnnotation.State) =>
    toolOutputGuard(state);

  const routeAfterLlm = (
    state: typeof FullGraphAnnotation.State
  ): "toolNode" | "critic" => {
    const lastMessage = state.messages.at(-1);
    if (!lastMessage || !AIMessage.isInstance(lastMessage)) return "critic";
    if (lastMessage.tool_calls?.length) return "toolNode";
    return "critic";
  };

  const criticNode = async (state: typeof FullGraphAnnotation.State) => {
    const draft = lastAiText(state.messages);
    const verdict = await criticModel.invoke([
      new SystemMessage(CRITIC_SYSTEM),
      new HumanMessage(
        `Черновик ответа ассистента:\n${draft.slice(0, 12_000)}\n\nВерни pass или revise.`
      ),
    ]);

    if (verdict.verdict === "pass") {
      return { critic_last_verdict: "pass" as const };
    }
    if ((state.critic_round ?? 0) >= MAX_CRITIC_REVISIONS) {
      console.warn("[CRITIC] достигнут лимит правок, принимаем последний черновик");
      return { critic_last_verdict: "pass" as const };
    }
    return {
      critic_last_verdict: "revise" as const,
      critic_round: (state.critic_round ?? 0) + 1,
      messages: [
        new SystemMessage(
          `Пересмотри ответ: ${verdict.feedback ?? "усиль опору на факты и образовательный тон."}`
        ),
      ],
    };
  };

  const routeAfterCritic = (
    state: typeof FullGraphAnnotation.State
  ): typeof END | "llmCall" => {
    if (state.critic_last_verdict === "pass") return END;
    return "llmCall";
  };

  return new StateGraph(FullGraphAnnotation)
    .addNode("input_guard", inputGuardNode)
    .addNode("coordinator", coordinatorNode)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", toolNode)
    .addNode("tool_output_guard", toolGuardNode)
    .addNode("critic", criticNode)
    .addEdge(START, "input_guard")
    .addConditionalEdges("input_guard", routeAfterInputGuardToCoordinator, [
      "coordinator",
      END,
    ])
    .addEdge("coordinator", "llmCall")
    .addConditionalEdges("llmCall", routeAfterLlm, ["toolNode", "critic"])
    .addEdge("toolNode", "tool_output_guard")
    .addEdge("tool_output_guard", "llmCall")
    .addConditionalEdges("critic", routeAfterCritic, ["llmCall", END])
    .compile({ checkpointer: cp });
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

export { Command };
