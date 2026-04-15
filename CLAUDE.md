# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication

Always respond to the user in Russian.

## About this project

LangGraph MCT Consultant Demo — учебный проект-семинар «Memory & Guardrails in LLM-Powered Agents» на LangGraph JS + Claude API. Домен: образовательный консультант по метакогнитивной терапии (МКТ) и ACT (терапия принятия и ответственности). Не входит в монорепозиторий Konnektu.

## Commands

```bash
pnpm install
pnpm dev            # Next.js на http://localhost:3040
pnpm dev:3000       # Next.js на порту 3000
pnpm build          # Production build
pnpm typecheck      # tsc --noEmit (оба tsconfig)
pnpm test           # Vitest unit-тесты (без LLM)
pnpm test:watch     # Vitest в watch-режиме
pnpm start          # CLI: прогон всех демо-сценариев

# Локальная инициализация базы знаний (без Vercel)
npx tsx --tsconfig tsconfig.cli.json scripts/ingest-pdf.ts <file.pdf> "Название"
npx tsx --tsconfig tsconfig.cli.json scripts/reembed.ts

# Интеграционный тест с реальным LLM
MCT_REGRESSION=1 ANTHROPIC_API_KEY=... pnpm test
```

## Environment variables

| Переменная | Обязательна | Описание |
|---|---|---|
| `ANTHROPIC_API_KEY` | Да | Ключ Anthropic |
| `ANTHROPIC_MODEL` | Нет | Модель (по умолчанию `claude-sonnet-4-20250514`) |
| `DATABASE_URL` | Нет | Postgres (или `POSTGRES_URL`, `NEON_DATABASE_URL`, `STORAGE_URL`) |
| `VOYAGE_API_KEY` | Нет | Voyage AI для векторных эмбеддингов базы знаний |
| `VOYAGE_MODEL` | Нет | Voyage-модель (по умолчанию `voyage-3`, 1024 dim) |
| `UPSTASH_REDIS_REST_URL` | Нет | Upstash Redis для rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Нет | Upstash Redis token |
| `MCT_EXTENDED_GRAPH` | Нет | `1` → расширенный граф (координатор + критик) |

Для CLI — `.env` в корне. Для Next.js — `.env.local`.

## Architecture

### TypeScript конфигурация

Два tsconfig: `tsconfig.json` (Next.js, `src/` + `app/`) и `tsconfig.cli.json` (только `src/`, для CLI через `tsx`). При добавлении CLI-файлов следить за обоими.

### Auth и Middleware

`middleware.ts` — Edge-middleware, проверяет cookie `mct_session` (UUID v4) на всех маршрутах кроме `PUBLIC_PATHS`:
```
/login, /api/auth/login, /api/auth/logout, /api/auth/request, /api/auth/verify, /api/db-health
```

Сессии хранятся в `mct_sessions` (Postgres) через `src/server/auth.ts`. `setupDbSchema()` вызывается лениво при первом запросе к `/api/auth/login` и создаёт все таблицы через `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (идемпотентно).

### База данных (Postgres + pgvector)

Таблицы создаются автоматически при первом логине (`src/server/db-schema.ts`):
- `mct_users`, `mct_sessions`, `mct_auth_tokens` — auth
- `mct_chat_sessions` — треды чата (поля: `user_id`, `thread_id`, `modality`, `started_at`, `ended_at`)
- `mct_exercise_logs`, `mct_homework`, `mct_therapist_clients`, `mct_client_analyses` — данные терапевта
- `mct_knowledge_sources`, `mct_knowledge_chunks` — база знаний (pgvector, `embedding vector(1024)`)

`getPgPool()` (`src/server/pg-pool.ts`) — singleton пула, возвращает `undefined` если нет DATABASE_URL.

### Thread ID и история чата

Thread ID хранится в БД (`mct_chat_sessions`), а не только в localStorage:
- `GET /api/chat/thread?modality=mct|act` → последний thread_id пользователя (или создаёт новый)
- `POST /api/chat/thread { modality }` → создаёт новый тред
- `src/server/session-db.ts`: `getOrCreateThread()`, `createNewThread()`, `createChatSession()`

### LangGraph граф (`seminar-graphs.ts: buildFullGraph`)

`MCT_EXTENDED_GRAPH=1` — расширенный граф, иначе классический:

- **Классический**: `input_guard → llmCall → toolNode → tool_output_guard → llmCall` — один агент, все tools. Укладывается в Vercel Hobby (10с таймаут).
- **Расширенный**: добавляет `coordinator` (structured output роутинг по веткам) и `critic` (до `MAX_CRITIC_REVISIONS=2` итераций правки).

Узлы графа:
1. `input_guard` (`guards.ts`) — классификатор on-topic + маскировка PII
2. `llmCall` — ReAct-агент с системным промптом из `src/prompts.ts`
3. `toolNode` — выполняет первый `tool_call` (TAO-паттерн)
4. `tool_output_guard` — удаляет упражнения с prompt-injection (паттерн `INJECTION_RE`)
5. `critic` (extended only) — structured output `{verdict, feedback}`

### Tools

| Tool | Файл | Описание |
|---|---|---|
| `search_exercises_or_resources` | `tools.ts` | Поиск упражнений из каталога `data.ts` |
| `update_client_profile` | `tools.ts` | Обновление профиля клиента в Postgres |
| `lookup_mct_reference` | `rag-tools.ts` | RAG по справочнику МКТ + pgvector поиск по загруженным книгам |
| `propose_homework_plan` | `homework-interrupt-tool.ts` | Предлагает план ДЗ + `interrupt` |

`lookup_mct_reference` использует два источника: встроенный справочник `mct-reference.ts` (keyword) и pgvector (семантический поиск по загруженным PDF).

### Checkpointer (`src/server/checkpointer.ts`)

Singleton: при наличии DATABASE_URL — `PostgresSaver` (с `setup()` при первом вызове), иначе `MemorySaver`. На Vercel без Postgres interrupt/resume теряется между инстансами.

### База знаний (Knowledge Base)

- Загрузка через `/api/admin/knowledge/upload` (PDF, TXT, MD) → chunking (`src/embeddings/chunker.ts`) → INSERT в `mct_knowledge_chunks` (embedding = NULL)
- Эмбеддинги через `POST /api/admin/knowledge/reembed` — батчи по 10 чанков, Voyage AI `voyage-3` (1024 dim). На Vercel Hobby добавлена задержка 21с между вызовами (лимит 3 RPM free plan).
- Поиск: `GET /api/admin/knowledge/search?q=...` — сначала vector (cosine similarity), fallback на pg full-text (`to_tsvector('russian', ...)`)

### Next.js API routes

```
POST /api/chat          { threadId, message, modality }  → { reply, interrupted, interruptPayload }
POST /api/resume        { threadId, resume }              → { reply }
GET  /api/chat/thread   ?modality=mct|act                → { threadId }
POST /api/chat/thread   { modality }                      → { threadId }
GET  /api/history       ?threadId=...                     → { messages }
GET  /api/db-health                                       → { ok, postgres, voyage }
POST /api/auth/login    { email, password }               → set-cookie mct_session
POST /api/auth/logout                                     → clear cookie
GET  /api/auth/me                                         → { user }
POST /api/admin/knowledge/upload                          → { ok, chunks }
POST /api/admin/knowledge/reembed                         → { ok, updated, remaining }
GET  /api/admin/knowledge/search  ?q=...&limit=8          → { results, mode }
```

Все `/api/admin/*` и `/api/therapist/*` требуют роль `admin` или `therapist` соответственно.

### Уведомления

`app/components/notifications.tsx` — `NotificationsProvider` обёрнут в `app/layout.tsx`. Хук `useNotify()` возвращает `notify({ type, message, action?, duration? })`. `duration: 0` = sticky toast.

### Системные промпты и probe-вопросы (`src/prompts.ts`)

`SYSTEM_PROMPT_V4` (MCT) и `SYSTEM_PROMPT_ACT_V4` содержат `MCT_PROBE_QUESTIONS` и `ACT_PROBE_QUESTIONS` — по 2 примера вопросов на каждую из 6 осей ACT Hexaflex и 6 осей MCT Profile. Правило: один зондирующий вопрос за ход, не повторять.

### Vercel-специфика

- Hobby plan: хардкод 10с на serverless function. `maxDuration=60` игнорируется.
- `VERCEL` env → `profile-store.ts` пишет в `/tmp` вместо `data/`.
- Voyage AI блокирует российские IP (403) → reembed только через Vercel deployment.
