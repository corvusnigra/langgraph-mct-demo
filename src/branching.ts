import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { proposeHomeworkPlan } from "./homework-interrupt-tool";
import { lookupMctReference } from "./rag-tools";
import { searchExercisesOrResources, updateClientProfile } from "./tools";

export const agentBranchSchema = z.enum([
  "exercise",
  "reference",
  "profile",
  "homework",
  "general",
]);

export type AgentBranch = z.infer<typeof agentBranchSchema>;

export const coordinatorRoutingSchema = z.object({
  branch: agentBranchSchema,
  rationale: z.string().optional(),
});

/**
 * Узкие наборы инструментов по ветке координатора (MAS).
 * - homework: полный набор, включая interrupt.
 * - general: без propose_homework_plan, чтобы не вызывать interrupt случайно.
 */
export function toolsForBranch(
  branch: AgentBranch
): StructuredToolInterface[] {
  const search = searchExercisesOrResources;
  const rag = lookupMctReference;
  const profile = updateClientProfile;
  const homework = proposeHomeworkPlan;

  switch (branch) {
    case "exercise":
      return [search];
    case "reference":
      return [rag];
    case "profile":
      return [profile];
    case "homework":
      return [search, rag, profile, homework];
    case "general":
    default:
      return [search, rag, profile];
  }
}
