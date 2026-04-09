import { describe, expect, it } from "vitest";
import { exerciseResourceArraySchema } from "../schemas";
import { toolsForBranch } from "../branching";
import { searchExercises } from "../data";

describe("regression: доменные инварианты", () => {
  it("каталог упражнений парсится в zod-схему", () => {
    const raw = searchExercises("тревога");
    const parsed = exerciseResourceArraySchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.length).toBeGreaterThan(0);
      expect(parsed.data[0].exercise_id).toBeDefined();
    }
  });

  it("toolsForBranch возвращает узкие наборы", () => {
    expect(toolsForBranch("exercise").map((t) => t.name)).toEqual([
      "search_exercises_or_resources",
    ]);
    expect(toolsForBranch("reference").map((t) => t.name)).toEqual([
      "lookup_mct_reference",
    ]);
    expect(toolsForBranch("profile").map((t) => t.name)).toEqual([
      "update_client_profile",
    ]);
    const hw = toolsForBranch("homework").map((t) => t.name);
    expect(hw).toContain("propose_homework_plan");
    expect(toolsForBranch("general").map((t) => t.name)).not.toContain(
      "propose_homework_plan"
    );
  });
});

const runLlmIntegration =
  process.env.MCT_REGRESSION === "1" && Boolean(process.env.ANTHROPIC_API_KEY);

describe("regression: интеграция графа (опционально)", () => {
  it.skipIf(!runLlmIntegration)(
    "короткий диалог сохраняет тему МКТ в ответе (MCT_REGRESSION=1)",
    async () => {
      const { HumanMessage } = await import("@langchain/core/messages");
      const { buildFullGraph, lastAiText, threadCfg } = await import(
        "../seminar-graphs"
      );
      const graph = buildFullGraph();
      const cfg = threadCfg("vitest-regression");
      const result = await graph.invoke(
        {
          messages: [
            new HumanMessage(
              "В двух предложениях: что такое руминация с точки зрения МКТ?"
            ),
          ],
        },
        cfg
      );
      const text = lastAiText(result.messages).toLowerCase();
      expect(text.length).toBeGreaterThan(20);
      expect(
        text.includes("румин") ||
          text.includes("мысл") ||
          text.includes("метакогн")
      ).toBe(true);
    }
  );
});
