# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication

Always respond to the user in Russian.

## About this project

LangGraph MCT Consultant Demo — учебный проект-семинар «Memory & Guardrails in LLM-Powered Agents» на LangGraph JS + Claude API в домене образовательного консультанта по метакогнитивной терапии (МКТ). Не входит в монорепозиторий Konnektu.

## Commands

```bash
pnpm install
pnpm start          # CLI: прогон всех демо-сценариев (несколько вызовов LLM)
pnpm dev            # Next.js веб-интерфейс на http://localhost:3040
pnpm dev:3000       # Next.js на порту 3000 (если 3040 занят)
pnpm build          # Production build (Next.js)
pnpm typecheck      # tsc --noEmit для обоих tsconfig
pnpm test           # Vitest (unit-тесты без LLM)
pnpm test:watch     # Vitest в режиме watch
```

Интеграционный тест с реальным LLM: `MCT_REGRESSION=1 ANTHROPIC_API_KEY=... pnpm test`

## Environment variables

| Переменная | Обязательна | Описание |
|---|---|---|
| `ANTHROPIC_API_KEY` | Да | Ключ Anthropic |
| `ANTHROPIC_MODEL` | Нет | Модель (по умолчанию `claude-sonnet-4-20250514`) |
| `DATABASE_URL` | Нет | Postgres (или `POSTGRES_URL`, `NEON_DATABASE_URL`, `STORAGE_URL`) |
| `MCT_EXTENDED_GRAPH` | Нет | `1` → расширенный граф (координатор + критик); по умолчанию классический |

Для CLI — `.env` в корне. Для Next.js — `.env.local`.

## Architecture

### Два режима графа (`seminar-graphs.ts: buildFullGraph`)

`MCT_EXTENDED_GRAPH=1` выбирает расширенный граф, иначе — классический:

- **Классический** (`buildFullGraphClassic`): `input_guard → llmCall → toolNode → tool_output_guard → llmCall` — один агент со всеми tools, нет координатора и критика. Укладывается в Vercel serverless таймаут.
- **Расширенный** (`buildFullGraphExtended`): добавляет `coordinator` (роутинг по веткам через structured output) и `critic` (циклическая правка черновика, до `MAX_CRITIC_REVISIONS=2` раз).

### Слои графа (семантически)

1. **`input_guard`** (`guards.ts`) — первый вызов: классификатор on-topic + маскировка PII. Блокирует офф-топик на первом сообщении.
2. **`llmCall`** — ReAct-агент. В расширенном режиме получает branch-специфичный набор tools из `branching.ts`.
3. **`toolNode`** — TAO: выполняет только первый `tool_call` (в простых графах — все). Логирует предупреждение при нескольких вызовах.
4. **`tool_output_guard`** (`guards.ts: toolOutputGuard`) — удаляет упражнения с prompt-injection в поле `notes` (паттерн: `INJECTION_RE`).
5. **`critic`** (только extended) — structured output `{verdict, feedback}`, при `revise` добавляет `SystemMessage` с замечаниями и возвращает на `llmCall`.

### Tools

| Tool | Файл | Описание |
|---|---|---|
| `search_exercises_or_resources` | `tools.ts` | Поиск упражнений из каталога `data.ts` |
| `update_client_profile` | `tools.ts` | Обновление `data/client_profile.json` |
| `lookup_mct_reference` | `rag-tools.ts` | Keyword RAG по справочнику МКТ (`mct-reference.ts`) |
| `propose_homework_plan` | `homework-interrupt-tool.ts` | Предлагает план ДЗ + `interrupt` (human-in-the-loop) |

### Checkpointer (`server/checkpointer.ts`)

Singleton: при наличии DB URL — `PostgresSaver` (с `setup()` при первом вызове), иначе `MemorySaver`. На Vercel без Postgres interrupt/resume теряется между инстансами.

### Next.js API

- `POST /api/chat` `{ threadId, message }` → `{ reply, interrupted, interruptPayload }`
- `POST /api/resume` `{ threadId, resume }` → продолжение после interrupt
- `GET /api/db-health` → проверка Postgres без ключа Anthropic

`getFullGraph()` (`server/full-graph.ts`) — singleton скомпилированного графа на процесс.

### Структура графов по шагам семинара

| Шаг | Функция | Где |
|---|---|---|
| 0–1 | `buildGraphBasic`, `buildGraphWithMemory`, `buildGraphWithProfile` | `graph.ts` |
| 2 | `buildGraphRag`, `buildGraphHyde` | `seminar-graphs.ts` |
| 3 | `buildGuardedGraph` | `seminar-graphs.ts` |
| 4 | `buildFullGraph` (classic/extended) | `seminar-graphs.ts` |

### TypeScript конфигурация

Два tsconfig: `tsconfig.json` (Next.js, `src/` + `app/`) и `tsconfig.cli.json` (только `src/`, для `pnpm start` через `tsx`). При добавлении CLI-файлов нужно следить за обоими.
