import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { interrupt } from "@langchain/langgraph";
import { EXERCISES } from "./data";
import { requestContext } from "./server/request-context";
import { saveHomework } from "./server/session-db";

export const proposeHomeworkPlan = tool(
  async ({
    exercise_id,
    client_name,
    email,
    homework_summary,
    weekly_sessions,
  }: {
    exercise_id: string;
    client_name: string;
    email: string;
    homework_summary: string;
    weekly_sessions?: string | null;
  }) => {
    const exercise = EXERCISES.find((e) => e.exercise_id === exercise_id);
    if (!exercise) {
      return `Ошибка: неизвестный exercise_id ${exercise_id}`;
    }

    console.log(
      `[TOOL] propose_homework_plan(${exercise_id}, ${client_name}, ${email}, …)`
    );

    const approval = interrupt({
      action: "propose_homework_plan",
      exercise_id,
      client_name,
      email,
      homework_summary,
      weekly_sessions: weekly_sessions ?? null,
      exercise: {
        title: exercise.title,
        duration_min: exercise.duration_min,
        modality: exercise.modality,
        focus_tags: exercise.focus_tags,
      },
    });

    if (approval !== "approved") {
      return `План не записан (решение оператора): ${String(approval)}`;
    }

    const ref =
      "HW" +
      randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

    // Persist to DB if user is authenticated
    const { userId, sessionId } = requestContext.get();
    if (userId) {
      saveHomework({
        userId,
        sessionId,
        exerciseId: exercise_id,
        ref,
        summary: homework_summary,
        weeklySessions: weekly_sessions,
      }).catch((err) => console.warn("[TOOL] saveHomework failed:", err));
    }

    return (
      `✅ Домашний план согласован и зафиксирован.\n` +
      `  Номер: ${ref}\n` +
      `  Упражнение: ${exercise_id} — ${exercise.title}\n` +
      `  Длительность: ~${exercise.duration_min} мин, формат: ${exercise.modality}\n` +
      `  Клиент: ${client_name}\n` +
      `  Email: ${email}\n` +
      `  Суть задания: ${homework_summary}\n` +
      (weekly_sessions ? `  Частота: ${weekly_sessions}\n` : "")
    );
  },
  {
    name: "propose_homework_plan",
    description: `Propose a homework plan based on an exercise from search_exercises_or_resources.
Requires exercise_id, client name, email, and a short homework_summary.
Call when all required fields are known — human approval is requested via interrupt.`,
    schema: z.object({
      exercise_id: z.string().describe("ID from search_exercises_or_resources"),
      client_name: z.string(),
      email: z
        .string()
        .refine(
          (v) => v.includes("@") && Boolean(v.split("@")[1]?.includes(".")),
          "Invalid email"
        ),
      homework_summary: z.string().describe("Concrete homework steps in plain language"),
      weekly_sessions: z.string().nullable().optional().describe("e.g. 3x per week"),
    }),
  }
);
