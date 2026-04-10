import "dotenv/config";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import { buildFullGraph, lastAiText } from "../seminar-graphs";
import { loadProfile, saveProfile } from "../profile-store";
import { guardGrader, policyGrader, profileGrader } from "./graders";
import { ironUserReply, isTerminalReply } from "./iron-user";
import { runJudge } from "./judge";
import { TASKS } from "./tasks";
import type { EvalResult, EvalTask, Trajectory, TrajectoryStep } from "./types";

const MAX_TURNS = 8;

// ── Console capture ───────────────────────────────────────────────────────────

function patchConsole(sink: string[]): () => void {
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  console.log = (...args: unknown[]) => {
    sink.push(args.map(String).join(" "));
    origLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    sink.push("[WARN] " + args.map(String).join(" "));
    origWarn(...args);
  };
  return () => {
    console.log = origLog;
    console.warn = origWarn;
  };
}

// ── Trajectory builder ────────────────────────────────────────────────────────

function buildTrajectory(
  taskId: string,
  messages: BaseMessage[],
  opts: {
    profileBefore: Record<string, string>;
    profileAfter: Record<string, string>;
    logLines: string[];
    interrupted: boolean;
    interruptPayload: unknown;
    turnCount: number;
  }
): Trajectory {
  const steps: TrajectoryStep[] = [];
  const toolCallNames: string[] = [];

  for (const msg of messages) {
    if (HumanMessage.isInstance(msg)) {
      steps.push({
        type: "user",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      });
    } else if (AIMessage.isInstance(msg)) {
      const content =
        typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      if (content) steps.push({ type: "agent", content });
      for (const tc of msg.tool_calls ?? []) {
        steps.push({
          type: "tool_call",
          content: JSON.stringify(tc.args).slice(0, 300),
          toolName: tc.name,
        });
        toolCallNames.push(tc.name);
      }
    } else if (ToolMessage.isInstance(msg)) {
      steps.push({
        type: "observation",
        content: String(msg.content).slice(0, 500),
        toolName: msg.name ?? undefined,
      });
    }
  }

  return {
    taskId,
    steps,
    finalResponse: lastAiText(messages),
    interrupted: opts.interrupted,
    interruptPayload: opts.interruptPayload,
    profileBefore: opts.profileBefore,
    profileAfter: opts.profileAfter,
    logLines: opts.logLines,
    toolCallNames,
    turnCount: opts.turnCount,
  };
}

// ── Interrupt payload extractor ───────────────────────────────────────────────

function extractInterruptPayload(result: unknown): unknown {
  const raw = (result as Record<symbol | string, unknown>)[INTERRUPT];
  const first = Array.isArray(raw) && raw.length > 0 ? raw[0] : undefined;
  if (first != null && typeof first === "object" && "value" in (first as object)) {
    return (first as { value: unknown }).value;
  }
  return first;
}

// ── Single task runner ────────────────────────────────────────────────────────

export async function runTask(
  task: EvalTask,
  graph: ReturnType<typeof buildFullGraph>,
  opts: { withJudge?: boolean } = {}
): Promise<EvalResult> {
  const profileBefore = await loadProfile();
  const logLines: string[] = [];
  const restoreConsole = patchConsole(logLines);

  const threadId = `eval-${task.id}-${Date.now()}`;
  const config = { configurable: { thread_id: threadId } };

  let result: unknown;
  let interrupted = false;
  let interruptPayload: unknown;
  let turnCount = 0;

  try {
    // ── First turn ────────────────────────────────────────────────────
    result = await graph.invoke({ messages: [new HumanMessage(task.query)] }, config);
    turnCount++;

    // ── Iron User / interrupt loop ────────────────────────────────────
    while (turnCount < MAX_TURNS) {
      if (isInterrupted(result as object)) {
        interrupted = true;
        interruptPayload = extractInterruptPayload(result);

        if (task.auto_resume) {
          // @ts-expect-error LangGraph Command type несовместим с state generics
          result = await graph.invoke(new Command({ resume: task.auto_resume }), config);
          turnCount++;
          // After resume the graph completes — exit loop
          break;
        }
        break;
      }

      if (!task.needs_dialogue) break;

      const messages = (result as { messages: BaseMessage[] }).messages;
      const ironReply = await ironUserReply(task, messages);
      if (isTerminalReply(ironReply)) break;

      result = await graph.invoke({ messages: [new HumanMessage(ironReply)] }, config);
      turnCount++;
    }
  } finally {
    restoreConsole();
  }

  const profileAfter = await loadProfile();
  // Restore profile so tasks don't bleed into each other
  await saveProfile(profileBefore);

  const messages = (result as { messages: BaseMessage[] }).messages ?? [];

  const trajectory = buildTrajectory(task.id, messages, {
    profileBefore,
    profileAfter,
    logLines,
    interrupted,
    interruptPayload,
    turnCount,
  });

  const guardGrade = guardGrader(task, trajectory);
  const profileGrade = profileGrader(task, trajectory);
  const policyGrade = policyGrader(task, trajectory);

  const judgeResult = opts.withJudge
    ? await runJudge(task, trajectory)
    : undefined;

  const pass = guardGrade.pass && profileGrade.pass && policyGrade.pass;

  return { task, trajectory, guardGrade, profileGrade, policyGrade, judgeResult, pass };
}

// ── Full eval suite ───────────────────────────────────────────────────────────

export async function runEval(opts: {
  tasks?: EvalTask[];
  withJudge?: boolean;
}): Promise<EvalResult[]> {
  const tasks = opts.tasks ?? TASKS;
  const graph = buildFullGraph();
  const results: EvalResult[] = [];

  for (const task of tasks) {
    process.stdout.write(`  [${task.id}] ${task.difficulty.padEnd(10)} ${task.query.slice(0, 55).padEnd(56)}`);
    try {
      const result = await runTask(task, graph, { withJudge: opts.withJudge });
      results.push(result);
      process.stdout.write(result.pass ? " ✅\n" : " ❌\n");
    } catch (err) {
      process.stdout.write(` 💥 ${String(err).slice(0, 60)}\n`);
      // Push a failed result so the suite continues
      const dummyTraj: Trajectory = {
        taskId: task.id,
        steps: [],
        finalResponse: "",
        interrupted: false,
        profileBefore: {},
        profileAfter: {},
        logLines: [],
        toolCallNames: [],
        turnCount: 0,
      };
      results.push({
        task,
        trajectory: dummyTraj,
        guardGrade: { pass: false, details: [`💥 ${String(err)}`] },
        profileGrade: { pass: false, details: [] },
        policyGrade: { pass: false, details: [] },
        pass: false,
      });
    }
  }

  return results;
}

// ── Report printer ────────────────────────────────────────────────────────────

export function printReport(results: EvalResult[]): void {
  const sep = "─".repeat(90);
  console.log("\n" + sep);
  console.log("EVAL REPORT");
  console.log(sep);

  const header = [
    "ID   ",
    "Diff      ",
    "Guard",
    "Profile",
    "Policy",
    "Judge(U/G/S)",
    "Overall",
  ].join("  ");
  console.log(header);
  console.log(sep);

  for (const r of results) {
    const g = r.guardGrade.pass ? "✅" : "❌";
    const p = r.profileGrade.pass ? "✅" : "❌";
    const po = r.policyGrade.pass ? "✅" : "❌";
    const j = r.judgeResult
      ? `${r.judgeResult.usefulness[0]}/${r.judgeResult.groundedness[0]}/${r.judgeResult.safety[0]}`
      : "    —    ";
    const overall = r.pass ? "PASS" : "FAIL";
    console.log(
      `${r.task.id.padEnd(5)}  ${r.task.difficulty.padEnd(10)}  ${g}     ${p}       ${po}     ${j}   ${overall}`
    );
  }

  console.log(sep);
  const passed = results.filter((r) => r.pass).length;
  console.log(`TOTAL: ${passed}/${results.length} passed`);

  // Details for failed tasks
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.log("\n── Failures ──");
    for (const r of failed) {
      console.log(`\n[${r.task.id}] ${r.task.query.slice(0, 70)}`);
      for (const d of [...r.guardGrade.details, ...r.profileGrade.details, ...r.policyGrade.details]) {
        if (d.startsWith("❌")) console.log("  " + d);
      }
    }
  }

  if (results.some((r) => r.judgeResult)) {
    console.log("\n── Judge details ──");
    for (const r of results) {
      if (!r.judgeResult) continue;
      console.log(`\n[${r.task.id}]`);
      for (const [criterion, reasoning] of Object.entries(r.judgeResult.reasoning)) {
        console.log(`  ${criterion}: ${reasoning.slice(0, 200)}`);
      }
    }
  }

  console.log(sep + "\n");
}

// ── CLI entry point ───────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Задайте ANTHROPIC_API_KEY в .env");
    process.exit(1);
  }

  const withJudge = process.env.MCT_JUDGE === "1";
  console.log(`\nMCT Eval Suite — ${TASKS.length} задач${withJudge ? " + LLM Judge" : ""}\n`);

  const results = await runEval({ withJudge });
  printReport(results);

  const passed = results.filter((r) => r.pass).length;
  process.exit(passed === results.length ? 0 : 1);
}

// Run when called directly (not imported as a module)
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
