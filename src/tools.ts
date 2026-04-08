import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchExercises } from "./data";
import { loadProfile, saveProfile } from "./profile-store";

export const searchExercisesOrResources = tool(
  async ({ query }: { query: string }) => {
    const results = searchExercises(query);
    console.log(
      `[TOOL] search_exercises_or_resources('${query.slice(0, 80)}') → ${results.length} items`
    );
    if (results.length === 0) {
      return `По запросу ничего не найдено. Попробуйте другие ключевые слова (тревога, сон, внимание, руминация).`;
    }
    return JSON.stringify(results, null, 2);
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
    const profile = await loadProfile();
    profile[key] = value;
    await saveProfile(profile);
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
