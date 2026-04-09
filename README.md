# LangGraph MCT Consultant Demo (TypeScript)

Полный порт семинара **Memory & Guardrails in LLM-Powered Agents** (LangGraph JS + Claude API) в домене **образовательного консультанта по метакогнитивной терапии (МКТ)**.

Не входит в монорепозиторий Konnektu — живёт отдельно в `~/langgraph-airline-demo`.

## Соответствие блокам семинара

| Шаг | Что в коде |
|-----|------------|
| 0–1 | `graph.ts`: наивный граф, `MemorySaver`, профиль JSON |
| 2 | `mct-reference.ts`, `rag-tools.ts`, `seminar-graphs.ts`: `lookup_mct_reference`, промпты RAG и HyDE |
| 3 | `guards.ts`, `buildGuardedGraph`: PII в логах, `input_guard`, `tool_output_guard` (инъекция в `notes` упражнений) |
| 4 | `homework-interrupt-tool.ts`, `buildFullGraph`: `propose_homework_plan` + `interrupt` + `Command({ resume })` + координатор веток + критик + TAO |

`pnpm start` прогоняет **все** сценарии подряд (несколько вызовов LLM).

## Требования

- Node.js 18+
- pnpm
- `ANTHROPIC_API_KEY` — [console.anthropic.com](https://console.anthropic.com)

## Установка и запуск

```bash
cd ~/langgraph-airline-demo
pnpm install
cp .env.example .env   # ANTHROPIC_API_KEY=...
pnpm start
```

Переменные: `ANTHROPIC_API_KEY`, опционально `ANTHROPIC_MODEL` (по умолчанию `claude-sonnet-4-20250514`). Для **Postgres** (Neon и т.д.) достаточно **одной** строки подключения: читается первая известная переменная — `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `STORAGE_URL` (префикс из Vercel Storage), `NEON_DATABASE_URL` — см. [`src/server/database-url.ts`](src/server/database-url.ts). Checkpointer: [`src/server/checkpointer.ts`](src/server/checkpointer.ts) (`PostgresSaver.setup()` при старте). Для своих SQL-запросов можно использовать [`src/server/pg-pool.ts`](src/server/pg-pool.ts). Для CLI: `.env` + `dotenv` в `main.ts`. Для Next: **`.env.local`** в корне проекта.

### Веб-интерфейс (Next.js)

```bash
cd ~/langgraph-airline-demo
pnpm install
# ANTHROPIC_API_KEY в .env.local
pnpm dev
```

1. В отдельном терминале из корня проекта выполните **`pnpm dev`** и дождитесь строки **`Ready`**.
2. Откройте в браузере [http://localhost:3040](http://localhost:3040) (или [http://127.0.0.1:3040](http://127.0.0.1:3040)).

Если порт занят или не открывается: **`pnpm dev:3000`** и заходите на [http://localhost:3000](http://localhost:3000).

Чат использует полный граф (`buildFullGraph`); после сценария с `propose_homework_plan` появится панель **Одобрить / Отклонить** (human-in-the-loop).

API: `POST /api/chat` `{ threadId, message }`, `POST /api/resume` `{ threadId, resume }`.

### Деплой на Vercel

1. Залейте репозиторий на GitHub/GitLab/Bitbucket (корень репозитория = корень этого проекта, где лежит `package.json`).
2. Зайдите на [vercel.com](https://vercel.com) → **Add New…** → **Project** → импортируйте репозиторий.
3. **Framework Preset:** Next.js (по умолчанию). **Build Command:** `pnpm build` (или оставьте автодетект; при наличии `pnpm-lock.yaml` Vercel обычно выберет pnpm).
4. **Environment Variables** (Settings → Environment Variables), для **Production** (и при желании Preview):
   - `ANTHROPIC_API_KEY` — ключ из [Anthropic Console](https://console.anthropic.com);
   - опционально `ANTHROPIC_MODEL` (иначе используется значение по умолчанию в коде);
   - опционально **`DATABASE_URL`** — строка подключения к Postgres для персистентных потоков и стабильного interrupt/resume между инстансами.
5. **Deploy.**

После деплоя откройте выданный URL (`*.vercel.app`).

**Ограничения serverless:** без `DATABASE_URL` используется `MemorySaver` **в памяти процесса**. На Vercel запросы могут попадать на разные инстансы — **длинные диалоги и interrupt/resume теряют нить** между инстансами. Задайте `DATABASE_URL` на Postgres (см. `.env.example`) для персистентного checkpointer.

Регрессионные проверки: `pnpm test` (Vitest). Интеграционный тест с LLM: задайте **`MCT_REGRESSION=1`** и валидный **`ANTHROPIC_API_KEY`**.

**Таймауты:** в API-роутах задано `maxDuration = 60` сек. На тарифе **Hobby** у Vercel лимит функции может быть жёстче (часто до 10 с) — при обрывах запросов к Claude рассмотрите **Pro** или оптимизацию цепочки.

## Структура `src/`

| Файл | Назначение |
|------|------------|
| `data.ts` | Мок упражнений (в т.ч. EX-777 с инъекцией в `notes`) |
| `mct-reference.ts` | Chunk справочника МКТ для keyword RAG |
| `tools.ts` | `search_exercises_or_resources`, `update_client_profile` |
| `rag-tools.ts` | Keyword `lookup_mct_reference` |
| `prompts.ts` | V1–V4, RAG, HyDE, disclaimer, домашний план |
| `guards.ts` | PII, `isOnTopic`, `toolOutputGuard` |
| `homework-interrupt-tool.ts` | `propose_homework_plan` + `interrupt` |
| `graph.ts` | Базовые три графа (шаг 0–1) |
| `seminar-graphs.ts` | RAG, HyDE, guarded, full (координатор веток, TAO, критик) |
| `branching.ts` | Ветки специалистов и узкие наборы tools |
| `schemas.ts` | Zod-схемы для JSON каталога упражнений |
| `server/checkpointer.ts` | Postgres или MemorySaver |
| `server/database-url.ts` | Единая строка подключения из env |
| `server/pg-pool.ts` | Опциональный пул `pg` для своих запросов |
| `server/full-graph.ts` | Асинхронная сборка графа для API |
| `profile-store.ts` | `data/client_profile.json` |
| `main.ts` | Единый демо-раннер |

## Проверка вручную

1. **Оффтоп** (первое сообщение): стихотворение про океан — отказ guard.
2. **По теме**: вопрос про руминацию / тревогу — ответ + при необходимости инструменты.
3. **Инъекция**: запрос поиска упражнений по тревоге — упражнение EX-777 с «ядом» в `notes` отфильтровывается guard’ом.
4. **Interrupt**: диалог с выбором упражнения и вызовом `propose_homework_plan` — панель подтверждения и `resume`.

## Документация

- [LangGraph JS](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
