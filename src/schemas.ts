import { z } from "zod";

/** Схема элемента каталога упражнений (совместима с `ExerciseResource` в data.ts). */
export const exerciseResourceSchema = z.object({
  exercise_id: z.string(),
  title: z.string(),
  focus_tags: z.array(z.string()),
  goal_summary: z.string(),
  duration_min: z.number(),
  modality: z.enum(["solo", "guided", "journal"]),
  notes: z.string(),
});

export const exerciseResourceArraySchema = z.array(exerciseResourceSchema);

export type ExerciseResourceValidated = z.infer<typeof exerciseResourceSchema>;
