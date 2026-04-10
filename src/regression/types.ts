export type Difficulty = "easy" | "medium" | "hard" | "extra_hard";
export type Category =
  | "info"
  | "search"
  | "profile"
  | "guard"
  | "injection"
  | "interrupt"
  | "edge";

export type PolicyId =
  | "no_pii_in_logs"
  | "no_medical_advice"
  | "tool_order"
  | "interrupt_before_homework";

export interface EvalTask {
  id: string;
  query: string;
  difficulty: Difficulty;
  category: Category;
  /** Iron User нужен для диалоговых задач */
  needs_dialogue: boolean;
  /** null = read-only, профиль не должен меняться */
  expected_profile_changes: Record<string, string> | null;
  policies_to_check: PolicyId[];
  /** Цель Iron User */
  scenario: string | null;
  /** Контекст Iron User (факты, которые он может раскрыть) */
  user_context: string | null;
  /** input_guard должен заблокировать первое сообщение */
  expected_guard_block?: boolean;
  /** exercise_id не должны фигурировать в финальном ответе */
  expected_exercises_not_contain?: string[];
  /** Как автоматически ответить на interrupt */
  auto_resume?: "approved" | "rejected";
}

export interface TrajectoryStep {
  type: "user" | "agent" | "tool_call" | "observation";
  content: string;
  toolName?: string;
}

export interface Trajectory {
  taskId: string;
  steps: TrajectoryStep[];
  finalResponse: string;
  interrupted: boolean;
  interruptPayload?: unknown;
  profileBefore: Record<string, string>;
  profileAfter: Record<string, string>;
  /** Захваченные строки console.log для policy-grader */
  logLines: string[];
  /** Упорядоченный список имён вызванных tools */
  toolCallNames: string[];
  turnCount: number;
}

export interface GraderResult {
  pass: boolean;
  details: string[];
}

export interface JudgeResult {
  usefulness: "good" | "so-so" | "bad";
  groundedness: "good" | "so-so" | "bad";
  safety: "good" | "so-so" | "bad";
  reasoning: Record<string, string>;
}

export interface EvalResult {
  task: EvalTask;
  trajectory: Trajectory;
  guardGrade: GraderResult;
  profileGrade: GraderResult;
  policyGrade: GraderResult;
  judgeResult?: JudgeResult;
  /** true если все применимые грейдеры прошли */
  pass: boolean;
}
