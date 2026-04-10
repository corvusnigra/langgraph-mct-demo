import { getPgPool } from "./pg-pool";

// ── Chat sessions ─────────────────────────────────────────────────────────────

export async function createChatSession(
  userId: string,
  threadId: string,
  moodBefore?: number
): Promise<string> {
  const pool = getPgPool();
  if (!pool) return "";
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO mct_chat_sessions (user_id, thread_id, mood_before)
     VALUES ($1, $2, $3)
     ON CONFLICT (thread_id) DO UPDATE SET user_id = $1
     RETURNING id`,
    [userId, threadId, moodBefore ?? null]
  );
  return rows[0]?.id ?? "";
}

export async function closeChatSession(threadId: string): Promise<void> {
  const pool = getPgPool();
  if (!pool) return;
  await pool.query(
    `UPDATE mct_chat_sessions SET ended_at = now()
     WHERE thread_id = $1 AND ended_at IS NULL`,
    [threadId]
  );
}

// ── Exercise logs ─────────────────────────────────────────────────────────────

export async function logExercise(opts: {
  userId: string;
  sessionId?: string;
  exerciseId: string;
}): Promise<void> {
  const pool = getPgPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO mct_exercise_logs (user_id, session_id, exercise_id)
     VALUES ($1, $2, $3)`,
    [opts.userId, opts.sessionId ?? null, opts.exerciseId]
  );
}

export async function getRecentSessions(
  userId: string,
  limit = 3
): Promise<Array<{ started_at: Date; exercises: string[] }>> {
  const pool = getPgPool();
  if (!pool) return [];
  const { rows } = await pool.query<{ started_at: Date; exercises: string[] }>(
    `SELECT s.started_at,
            COALESCE(
              array_agg(el.exercise_id ORDER BY el.completed_at)
              FILTER (WHERE el.exercise_id IS NOT NULL),
              '{}'
            ) AS exercises
     FROM mct_chat_sessions s
     LEFT JOIN mct_exercise_logs el ON el.session_id = s.id
     WHERE s.user_id = $1
     GROUP BY s.id
     ORDER BY s.started_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

// ── Homework ──────────────────────────────────────────────────────────────────

export async function saveHomework(opts: {
  userId: string;
  sessionId?: string;
  exerciseId: string;
  ref: string;
  summary: string;
  weeklySessions?: string | null;
}): Promise<void> {
  const pool = getPgPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO mct_homework
       (user_id, session_id, exercise_id, homework_ref, summary, weekly_sessions)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (homework_ref) DO NOTHING`,
    [
      opts.userId,
      opts.sessionId ?? null,
      opts.exerciseId,
      opts.ref,
      opts.summary,
      opts.weeklySessions ?? null,
    ]
  );
}

export async function getPendingHomework(therapistId: string): Promise<
  Array<{
    id: string;
    homework_ref: string;
    summary: string;
    exercise_id: string;
    weekly_sessions: string | null;
    created_at: Date;
    client_email: string;
    client_id: string;
  }>
> {
  const pool = getPgPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT hw.id, hw.homework_ref, hw.summary, hw.exercise_id,
            hw.weekly_sessions, hw.created_at,
            u.email AS client_email, u.id AS client_id
     FROM mct_homework hw
     JOIN mct_users u ON u.id = hw.user_id
     JOIN mct_therapist_clients tc ON tc.client_id = hw.user_id
     WHERE tc.therapist_id = $1 AND hw.status = 'pending'
     ORDER BY hw.created_at DESC`,
    [therapistId]
  );
  return rows;
}

export async function approveHomework(
  homeworkId: string,
  therapistId: string,
  approved: boolean
): Promise<void> {
  const pool = getPgPool();
  if (!pool) return;
  await pool.query(
    `UPDATE mct_homework
     SET status = $1, approved_by = $2, approved_at = now()
     WHERE id = $3`,
    [approved ? "approved" : "rejected", therapistId, homeworkId]
  );
}

// ── Therapist clients ─────────────────────────────────────────────────────────

export async function getTherapistClients(therapistId: string): Promise<
  Array<{ id: string; email: string; sessions_count: number; pending_hw: number }>
> {
  const pool = getPgPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT u.id, u.email,
            COUNT(DISTINCT s.id)::int AS sessions_count,
            COUNT(DISTINCT hw.id) FILTER (WHERE hw.status = 'pending')::int AS pending_hw
     FROM mct_therapist_clients tc
     JOIN mct_users u ON u.id = tc.client_id
     LEFT JOIN mct_chat_sessions s ON s.user_id = u.id
     LEFT JOIN mct_homework hw ON hw.user_id = u.id
     WHERE tc.therapist_id = $1
     GROUP BY u.id, u.email
     ORDER BY u.email`,
    [therapistId]
  );
  return rows;
}
