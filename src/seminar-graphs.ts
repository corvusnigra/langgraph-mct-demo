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
import { ToolMessage } from "@langchain/core/messages";
import {
  inputGuard,
  routeAfterInputGuard,
  routeAfterInputGuardToCoordinator,
  toolOutputGuard,
} from "./guards";
import {
  COORDINATOR_SYSTEM,
  CRITIC_SYSTEM,
  SYSTEM_PROMPT_ACT_V4,
  SYSTEM_PROMPT_V2_RAG,
  SYSTEM_PROMPT_V3,
  SYSTEM_PROMPT_V4,
} from "./prompts";
import { formatProfileBlock } from "./profile-store";
import { loadProfileForUser } from "./server/profile-db";
import { requestContext } from "./server/request-context";
import { getRecentSessions } from "./server/session-db";
import { lookupMctReference } from "./rag-tools";
import { searchExercisesOrResources, updateClientProfile } from "./tools";
import { proposeHomeworkPlan } from "./homework-interrupt-tool";
import {
  coordinatorRoutingSchema,
  toolsForBranch,
  type AgentBranch,
} from "./branching";
import {
  buildToolsByName,
  createChatModel,
  lastAiText,
  lastAiTextFinal,
  threadConfig,
} from "./shared";

const AgentState = new StateSchema({
  messages: MessagesValue,
});

const MAX_CRITIC_REVISIONS = 2;

/** Строит system prompt с профилем пользователя и историей сессий; кеширует результат в requestContext (#7). */
async function buildSystemPrompt(base: string): Promise<string> {
  const ctx = requestContext.get();
  const cacheKey = `__systemPrompt_${base.slice(0, 40)}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cache = ctx as any;
  if (cache[cacheKey]) return cache[cacheKey] as string;

  const { userId } = ctx;
  const [profile, history] = await Promise.all([
    loadProfileForUser(userId),
    userId ? getRecentSessions(userId) : Promise.resolve([]),
  ]);
  let system = base + formatProfileBlock(profile);
  if (history.length > 0) {
    const lines = history.map((s) => {
      const exStr = s.exercises.length
        ? s.exercises.join(", ")
        : "упражнений не просматривалось";
      return `- ${s.started_at.toLocaleDateString("ru-RU")}: ${exStr}`;
    });
    system += `\n\n## Предыдущие сессии клиента\n${lines.join("\n")}\n`;
  }
  cache[cacheKey] = system;
  return system;
}

const FullGraphAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  routing_branch: Annotation<AgentBranch>(),
  critic_round: Annotation<number>(),
  critic_last_verdict: Annotation<"pass" | "revise" | undefined>(),
  /** Счётчик ошибок инструмента для ограничения бесконечных retry (#6). */
  tool_error_round: Annotation<number>(),
});

type SystemFn = () => Promise<string>;

function buildReactLoop(
  getSystem: SystemFn,
  tools: StructuredToolInterface[],
  model: ReturnType<typeof createChatModel>
) {
  const map = buildToolsByName(tools);
  const modelWithTools = model.bindTools(tools);

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
    if (!t) {
      console.warn(`[TOOL] неизвестный инструмент: ${toolCall.name}`);
      return {
        messages: [
          new ToolMessage({
            content: `Ошибка: инструмент «${toolCall.name}» не найден.`,
            tool_call_id: toolCall.id ?? "",
          }),
        ],
      };
    }
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

function wireSimpleGraph(
  llmCall: (state: { messages: BaseMessage[] }) => Promise<{ messages: BaseMessage[] }>,
  toolNode: (state: { messages: BaseMessage[] }) => Promise<{ messages: BaseMessage[] }>,
  route: (state: { messages: BaseMessage[] }) => typeof END | "toolNode",
  checkpointer?: BaseCheckpointSaver
) {
  return new StateGraph(AgentState)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", toolNode)
    .addEdge(START, "llmCall")
    .addConditionalEdges("llmCall", route, ["toolNode", END])
    .addEdge("toolNode", "llmCall")
    .compile({ checkpointer });
}

export function buildGraphRag() {
  const checkpointer = new MemorySaver();
  const tools = [searchExercisesOrResources, lookupMctReference, updateClientProfile];
  const model = createChatModel();
  const { llmCall, toolNode, shouldContinue } = buildReactLoop(
    async () => buildSystemPrompt(SYSTEM_PROMPT_V2_RAG),
    tools,
    model
  );
  return wireSimpleGraph(llmCall, toolNode, shouldContinue, checkpointer);
}

export function buildGraphHyde() {
  const checkpointer = new MemorySaver();
  const tools = [searchExercisesOrResources, lookupMctReference, updateClientProfile];
  const model = createChatModel();
  const { llmCall, toolNode, shouldContinue } = buildReactLoop(
    async () => buildSystemPrompt(SYSTEM_PROMPT_V3),
    tools,
    model
  );
  return wireSimpleGraph(llmCall, toolNode, shouldContinue, checkpointer);
}

export function buildGuardedGraph() {
  const checkpointer = new MemorySaver();
  const tools = [searchExercisesOrResources, lookupMctReference, updateClientProfile];
  const model = createChatModel();
  const classifier = createChatModel();
  const { llmCall, toolNode, shouldContinue } = buildReactLoop(
    async () => buildSystemPrompt(SYSTEM_PROMPT_V3),
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

/** Выбирает базовый промпт полного графа по модальности из requestContext. */
function getFullGraphBasePrompt(): string {
  const { modality } = requestContext.get();
  return modality === "act" ? SYSTEM_PROMPT_ACT_V4 : SYSTEM_PROMPT_V4;
}

function buildFullGraphClassic(checkpointer?: BaseCheckpointSaver) {
  const cp = checkpointer ?? new MemorySaver();
  const tools = [
    searchExercisesOrResources,
    lookupMctReference,
    updateClientProfile,
    proposeHomeworkPlan,
  ];
  const model = createChatModel();
  const classifier = createChatModel();
  const { llmCall, toolNode, shouldContinue } = buildReactLoop(
    async () => buildSystemPrompt(getFullGraphBasePrompt()),
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
    .compile({ checkpointer: cp });
}

function buildFullGraphExtended(checkpointer?: BaseCheckpointSaver) {
  const cp = checkpointer ?? new MemorySaver();
  const model = createChatModel();
  const classifier = createChatModel();
  const coordinatorModel = createChatModel().withStructuredOutput(
    coordinatorRoutingSchema
  );
  const criticModel = createChatModel().withStructuredOutput(criticVerdictSchema);

  const getBaseSystem = () => buildSystemPrompt(getFullGraphBasePrompt());

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
    const modelWithTools = model.bindTools(tools);
    const system = await getBaseSystem();
    const response = await modelWithTools.invoke([
      new SystemMessage(system),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  const mapAllTools = buildToolsByName([
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
      console.warn(`[TOOL] неизвестный инструмент: ${toolCall.name}`);
      return {
        messages: [
          new ToolMessage({
            content: `Ошибка: инструмент «${toolCall.name}» не найден.`,
            tool_call_id: toolCall.id ?? "",
          }),
        ],
      };
    }
    try {
      const msg = await t.invoke(toolCall);
      return { messages: [msg], tool_error_round: 0 };
    } catch (err) {
      const round = (state.tool_error_round ?? 0) + 1;
      console.warn(`[TOOL] ошибка вызова ${toolCall.name} (round ${round}):`, err);
      return {
        messages: [
          new ToolMessage({
            content: `Ошибка инструмента: ${err instanceof Error ? err.message : String(err)}`,
            tool_call_id: toolCall.id ?? "",
          }),
        ],
        tool_error_round: round,
      };
    }
  };

  const toolGuardNode = (state: typeof FullGraphAnnotation.State) =>
    toolOutputGuard(state);

  const routeAfterLlm = (
    state: typeof FullGraphAnnotation.State
  ): "toolNode" | "critic" => {
    const lastMessage = state.messages.at(-1);
    if (!lastMessage || !AIMessage.isInstance(lastMessage)) return "critic";
    if (lastMessage.tool_calls?.length) {
      // #6: если превышен лимит ошибок tool — идём на критика (не зацикливаться)
      const MAX_TOOL_ERRORS = 3;
      if ((state.tool_error_round ?? 0) >= MAX_TOOL_ERRORS) {
        console.warn(`[TAO] лимит tool_error_round (${MAX_TOOL_ERRORS}) достигнут, передаём критику`);
        return "critic";
      }
      return "toolNode";
    }
    return "critic";
  };

  const criticNode = async (state: typeof FullGraphAnnotation.State) => {
    const draft = lastAiTextFinal(state.messages); // #8: финальный текст без tool_calls
    if (!draft) {
      // Нет финального текста — последним был tool_call, critic пропускаем
      return { critic_last_verdict: "pass" as const };
    }
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

export function buildFullGraph(checkpointer?: BaseCheckpointSaver) {
  if (process.env.MCT_EXTENDED_GRAPH === "1") {
    console.log("[graph] buildFullGraph: extended (coordinator + critic)");
    return buildFullGraphExtended(checkpointer);
  }
  return buildFullGraphClassic(checkpointer);
}

export { threadConfig as threadCfg, lastAiText, Command };
