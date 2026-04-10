import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchExercises } from "./data";
import { exerciseResourceArraySchema } from "./schemas";
import { requestContext } from "./server/request-context";
import { logExercise } from "./server/session-db";
import { loadProfileForUser, saveProfileForUser } from "./server/profile-db";

export const searchExercisesOrResources = tool(
  async ({ query }: { query: string }) => {
    const results = searchExercises(query);
    console.log(
      `[TOOL] search_exercises_or_resources('${query.slice(0, 80)}') → ${results.length} items`
    );
    if (results.length === 0) {
      return `По запросу ничего не найдено. Попробуйте другие ключевые слова (тревога, сон, внимание, руминация).`;
    }
    const parsed = exerciseResourceArraySchema.safeParse(results);
    if (!parsed.success) {
      console.error("[TOOL] search_exercises_or_resources: невалидный JSON каталога", parsed.error);
      return "Внутренняя ошибка каталога упражнений.";
    }

    // Log viewed exercises for the current user (fire-and-forget)
    const { userId, sessionId } = requestContext.get();
    if (userId) {
      for (const ex of parsed.data) {
        logExercise({ userId, sessionId, exerciseId: ex.exercise_id }).catch(
          (err) => console.warn("[TOOL] logExercise failed:", err)
        );
      }
    }

    return JSON.stringify(parsed.data, null, 2);
  },
  {
    name: "search_exercises_or_resources",
    description: `Search the catalog of MCT-related exercises and micro-practices by keywords
(tags: worry, rumination, sleep, attention, CAS, etc.). Returns JSON array.`,
    schema: z.object({
      query: z
        .string()
        .describe("Keywords or short phrase, Russian or English"),
    }),
  }
);

export const updateClientProfile = tool(
  async ({ key, value }: { key: string; value: string }) => {
    console.log(`[TOOL] update_client_profile('${key}', …)`);
    const { userId } = requestContext.get();
    const profile = await loadProfileForUser(userId);
    profile[key] = value;
    await saveProfileForUser(profile, userId);
    return `Профиль обновлён: ${key}`;
  },
  {
    name: "update_client_profile",
    description: `Save a field to the client's persistent profile (goals, triggers, preferences).`,
    schema: z.object({
      key: z.string().describe("Field name, e.g. name, email, focus_area"),
      value: z.string().describe("Value to store"),
    }),
  }
);
