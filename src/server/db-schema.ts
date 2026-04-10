import { getPgPool } from "./pg-pool";

let setupPromise: Promise<void> | null = null;

/** Создаёт все MCT-таблицы если не существуют. Вызывается лениво при первом auth-запросе. */
export async function setupDbSchema(): Promise<void> {
  if (!setupPromise) {
    setupPromise = doSetup();
  }
  return setupPromise;
}

async function doSetup(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    console.log("[db-schema] Postgres не настроен — таблицы не создаются");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mct_users (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      email       TEXT        UNIQUE NOT NULL,
      role        TEXT        NOT NULL DEFAULT 'client',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mct_auth_tokens (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        NOT NULL REFERENCES mct_users(id) ON DELETE CASCADE,
      token       TEXT        UNIQUE NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      used        BOOLEAN     NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mct_sessions (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        NOT NULL REFERENCES mct_users(id) ON DELETE CASCADE,
      token       TEXT        UNIQUE NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mct_profiles (
      user_id     UUID        PRIMARY KEY REFERENCES mct_users(id) ON DELETE CASCADE,
      data        JSONB       NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mct_chat_sessions (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        NOT NULL REFERENCES mct_users(id) ON DELETE CASCADE,
      thread_id   TEXT        UNIQUE NOT NULL,
      mood_before SMALLINT,
      started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at    TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS mct_exercise_logs (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        NOT NULL REFERENCES mct_users(id) ON DELETE CASCADE,
      session_id  UUID        REFERENCES mct_chat_sessions(id),
      exercise_id TEXT        NOT NULL,
      feedback    TEXT,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mct_homework (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID        NOT NULL REFERENCES mct_users(id) ON DELETE CASCADE,
      session_id      UUID        REFERENCES mct_chat_sessions(id),
      exercise_id     TEXT        NOT NULL,
      homework_ref    TEXT        UNIQUE NOT NULL,
      summary         TEXT        NOT NULL,
      weekly_sessions TEXT,
      status          TEXT        NOT NULL DEFAULT 'pending',
      approved_by     UUID        REFERENCES mct_users(id),
      approved_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mct_therapist_clients (
      therapist_id UUID NOT NULL REFERENCES mct_users(id) ON DELETE CASCADE,
      client_id    UUID NOT NULL REFERENCES mct_users(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (therapist_id, client_id)
    );
  `);

  console.log("[db-schema] схема MCT инициализирована");
}
