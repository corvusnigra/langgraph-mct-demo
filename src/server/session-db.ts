import { getPgPool } from "./pg-pool";

// ── Chat sessions ─────────────────────────────────────────────────────────────

export async function createChatSession(
  userId: string,
  threadId: string,
  moodBefore?: number,
  modality: "mct" | "act" = "mct"
): Promise<string> {
  const pool = getPgPool();
  if (!pool) return "";
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO mct_chat_sessions (user_id, thread_id, mood_before, modality)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (thread_id) DO UPDATE SET user_id = $1
     RETURNING id`,
    [userId, threadId, moodBefore ?? null, modality]
  );
  return rows[0]?.id ?? "";
}

/** Возвращает последний thread_id пользователя для заданной модальности.
 *  Если записей нет — создаёт новую и возвращает её thread_id. */
export async function getOrCreateThread(
  userId: string,
  modality: "mct" | "act"
): Promise<string> {
  const pool = getPgPool();
  if (!pool) return crypto.randomUUID();
  const { rows } = await pool.query<{ thread_id: string }>(
    `SELECT thread_id FROM mct_chat_sessions
     WHERE user_id = $1 AND modality = $2
     ORDER BY started_at DESC LIMIT 1`,
    [userId, modality]
  );
  if (rows.length > 0) return rows[0].thread_id;
  // Создаём первую сессию
  const threadId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO mct_chat_sessions (user_id, thread_id, modality) VALUES ($1, $2, $3)`,
    [userId, threadId, modality]
  );
  return threadId;
}

/** Создаёт новый thread и возвращает его id. */
export async function createNewThread(
  userId: string,
  modality: "mct" | "act"
): Promise<string> {
  const pool = getPgPool();
  const threadId = crypto.randomUUID();
  if (!pool) return threadId;
  await pool.query(
    `INSERT INTO mct_chat_sessions (user_id, thread_id, modality) VALUES ($1, $2, $3)`,
    [userId, threadId, modality]
  );
  return threadId;
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

export interface ClientAnalytics {
  id: string;
  email: string;
  total_sessions: number;
  avg_duration_min: number | null;
  last_session: Date | null;
  unique_exercises: number;
  homework_total: number;
  homework_approved: number;
}

export interface ExerciseStat {
  exercise_id: string;
  views: number;
}

export interface RecentSession {
  session_id: string;
  client_email: string;
  started_at: Date;
  ended_at: Date | null;
  exercises: string[];
}

export interface TherapistAnalytics {
  clients: ClientAnalytics[];
  top_exercises: ExerciseStat[];
  recent_sessions: RecentSession[];
  total_sessions_week: number;
}

export interface ClientDetail {
  id: string;
  email: string;
  profile: Record<string, string>;
  total_sessions: number;
  avg_duration_min: number | null;
  last_session: Date | null;
  homework_total: number;
  homework_approved: number;
  top_exercises: { exercise_id: string; views: number }[];
  recent_sessions: {
    session_id: string;
    started_at: Date;
    ended_at: Date | null;
    exercises: string[];
  }[];
}

export async function getClientDetail(
  therapistId: string,
  clientId: string
): Promise<ClientDetail | null> {
  const pool = getPgPool();
  if (!pool) return null;

  const [userRes, statsRes, exercisesRes, sessionsRes, profileRes] = await Promise.all([
    pool.query<{ id: string; email: string }>(
      `SELECT u.id, u.email
       FROM mct_users u
       JOIN mct_therapist_clients tc ON tc.client_id = u.id
       WHERE tc.therapist_id = $1 AND u.id = $2`,
      [therapistId, clientId]
    ),
    pool.query<{
      total_sessions: number;
      avg_duration_min: number | null;
      last_session: Date | null;
      homework_total: number;
      homework_approved: number;
    }>(
      `SELECT
         COUNT(DISTINCT s.id)::int                                         AS total_sessions,
         AVG(EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60)        AS avg_duration_min,
         MAX(s.started_at)                                                 AS last_session,
         COUNT(DISTINCT hw.id)::int                                        AS homework_total,
         COUNT(DISTINCT hw.id) FILTER (WHERE hw.status = 'approved')::int AS homework_approved
       FROM mct_users u
       LEFT JOIN mct_chat_sessions s  ON s.user_id  = u.id
       LEFT JOIN mct_homework hw      ON hw.user_id  = u.id
       WHERE u.id = $1`,
      [clientId]
    ),
    pool.query<{ exercise_id: string; views: number }>(
      `SELECT exercise_id, COUNT(*)::int AS views
       FROM mct_exercise_logs
       WHERE user_id = $1
       GROUP BY exercise_id
       ORDER BY views DESC
       LIMIT 10`,
      [clientId]
    ),
    pool.query<{ session_id: string; started_at: Date; ended_at: Date | null; exercises: string[] }>(
      `SELECT
         s.id AS session_id, s.started_at, s.ended_at,
         COALESCE(
           ARRAY_AGG(DISTINCT el.exercise_id) FILTER (WHERE el.exercise_id IS NOT NULL),
           '{}'
         ) AS exercises
       FROM mct_chat_sessions s
       LEFT JOIN mct_exercise_logs el ON el.session_id = s.id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.started_at DESC
       LIMIT 20`,
      [clientId]
    ),
    pool.query<{ data: Record<string, string> }>(
      `SELECT data FROM mct_profiles WHERE user_id = $1`,
      [clientId]
    ),
  ]);

  const user = userRes.rows[0];
  if (!user) return null;
  const stats = statsRes.rows[0];

  return {
    ...user,
    profile: profileRes.rows[0]?.data ?? {},
    total_sessions: stats.total_sessions,
    avg_duration_min: stats.avg_duration_min,
    last_session: stats.last_session,
    homework_total: stats.homework_total,
    homework_approved: stats.homework_approved,
    top_exercises: exercisesRes.rows,
    recent_sessions: sessionsRes.rows,
  };
}

export async function getClientThreadIds(userId: string): Promise<string[]> {
  const pool = getPgPool();
  if (!pool) return [];
  const { rows } = await pool.query<{ thread_id: string }>(
    `SELECT thread_id FROM mct_chat_sessions
     WHERE user_id = $1
     ORDER BY started_at DESC
     LIMIT 10`,
    [userId]
  );
  return rows.map((r) => r.thread_id);
}

export async function getTherapistAnalytics(
  therapistId: string
): Promise<TherapistAnalytics> {
  const pool = getPgPool();
  if (!pool) {
    return { clients: [], top_exercises: [], recent_sessions: [], total_sessions_week: 0 };
  }

  const [clientsRes, exercisesRes, recentRes, weekRes] = await Promise.all([
    pool.query<ClientAnalytics>(
      `SELECT
        u.id,
        u.email,
        COUNT(DISTINCT s.id)::int                                          AS total_sessions,
        AVG(EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60)         AS avg_duration_min,
        MAX(s.started_at)                                                  AS last_session,
        COUNT(DISTINCT el.exercise_id)::int                                AS unique_exercises,
        COUNT(DISTINCT hw.id)::int                                         AS homework_total,
        COUNT(DISTINCT hw.id) FILTER (WHERE hw.status = 'approved')::int  AS homework_approved
       FROM mct_therapist_clients tc
       JOIN mct_users u ON u.id = tc.client_id
       LEFT JOIN mct_chat_sessions s  ON s.user_id  = u.id
       LEFT JOIN mct_exercise_logs el ON el.user_id  = u.id
       LEFT JOIN mct_homework hw      ON hw.user_id  = u.id
       WHERE tc.therapist_id = $1
       GROUP BY u.id, u.email
       ORDER BY last_session DESC NULLS LAST`,
      [therapistId]
    ),
    pool.query<ExerciseStat>(
      `SELECT el.exercise_id, COUNT(*)::int AS views
       FROM mct_exercise_logs el
       JOIN mct_therapist_clients tc ON tc.client_id = el.user_id
       WHERE tc.therapist_id = $1
       GROUP BY el.exercise_id
       ORDER BY views DESC
       LIMIT 10`,
      [therapistId]
    ),
    pool.query<RecentSession>(
      `SELECT
        s.id          AS session_id,
        u.email       AS client_email,
        s.started_at,
        s.ended_at,
        COALESCE(
          ARRAY_AGG(DISTINCT el.exercise_id) FILTER (WHERE el.exercise_id IS NOT NULL),
          '{}'
        )             AS exercises
       FROM mct_chat_sessions s
       JOIN mct_users u ON u.id = s.user_id
       JOIN mct_therapist_clients tc ON tc.client_id = s.user_id
       LEFT JOIN mct_exercise_logs el ON el.session_id = s.id
       WHERE tc.therapist_id = $1
       GROUP BY s.id, u.email
       ORDER BY s.started_at DESC
       LIMIT 20`,
      [therapistId]
    ),
    pool.query<{ cnt: number }>(
      `SELECT COUNT(DISTINCT s.id)::int AS cnt
       FROM mct_chat_sessions s
       JOIN mct_therapist_clients tc ON tc.client_id = s.user_id
       WHERE tc.therapist_id = $1
         AND s.started_at >= now() - interval '7 days'`,
      [therapistId]
    ),
  ]);

  return {
    clients: clientsRes.rows,
    top_exercises: exercisesRes.rows,
    recent_sessions: recentRes.rows,
    total_sessions_week: weekRes.rows[0]?.cnt ?? 0,
  };
}

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
