/**
 * Полный порт семинара Memory & Guardrails (шаги 0–4).
 * Загрузка .env: dotenv (положите ANTHROPIC_API_KEY в ~/langgraph-airline-demo/.env).
 */
import "dotenv/config";
import "node:process";
import { HumanMessage } from "@langchain/core/messages";
import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import { saveProfile } from "./profile-store";
import {
  buildGraphBasic,
  buildGraphWithMemory,
  buildGraphWithProfile,
  invokeOnce,
  lastAiText,
  threadConfig,
} from "./graph";
import {
  buildFullGraph,
  buildGraphHyde,
  buildGraphRag,
  buildGuardedGraph,
  threadCfg,
  lastAiText as lastAi,
} from "./seminar-graphs";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "Задайте ANTHROPIC_API_KEY в .env или окружении: https://console.anthropic.com/"
    );
    process.exit(1);
  }

  // --- 1–3: базовые сценарии (graph.ts) ---
  console.log("=== 1) Наивный вызов без истории ===\n");
  const basic = buildGraphBasic();
  const r1 = await invokeOnce(
    basic,
    "Подбери упражнения по теме тревоги и руминации"
  );
  console.log("Agent:", r1.slice(0, 500), r1.length > 500 ? "…" : "", "\n");

  const r2 = await invokeOnce(basic, "Какое из них самое короткое по времени?");
  console.log("Agent (без памяти):", r2.slice(0, 400), "…\n");

  console.log("=== 2) Краткосрочная память (thread_id) ===\n");
  const mem = buildGraphWithMemory();
  const cfgMem = threadConfig("demo-thread-1");
  const m1 = await mem.invoke(
    {
      messages: [
        new HumanMessage("Найди в каталоге практики с тегом sleep"),
      ],
    },
    cfgMem
  );
  console.log("Turn 1:", lastAiText(m1.messages).slice(0, 400), "…\n");
  const m2 = await mem.invoke(
    { messages: [new HumanMessage("Кратко перечисли найденные названия")] },
    cfgMem
  );
  console.log("Turn 2:", lastAiText(m2.messages).slice(0, 500), "…\n");

  console.log("=== 3) Долгосрочный профиль (JSON) ===\n");
  await saveProfile({});
  const profileGraph = buildGraphWithProfile();
  const pc = threadConfig("profile-session-a");
  const p1 = await profileGraph.invoke(
    {
      messages: [
        new HumanMessage(
          "Привет, меня зовут Иван. Часто кручу неприятные мысли вечером, хочу разобраться с руминацией."
        ),
      ],
    },
    pc
  );
  console.log("Session A:", lastAiText(p1.messages).slice(0, 450), "…\n");
  const p2 = await profileGraph.invoke(
    { messages: [new HumanMessage("Что ты сохранил обо мне в профиле?")] },
    threadConfig("profile-session-b")
  );
  console.log(
    "Session B:",
    lastAiText(p2.messages).slice(0, 450),
    "…\n"
  );

  // --- 4: RAG (прямой запрос) ---
  console.log("=== 4) RAG: keyword lookup_mct_reference ===\n");
  const rag = buildGraphRag();
  const ragRes = await rag.invoke(
    {
      messages: [
        new HumanMessage(
          "What is the Cognitive Attentional Syndrome in one paragraph?"
        ),
      ],
    },
    threadCfg("rag-basic")
  );
  console.log(lastAi(ragRes.messages).slice(0, 600), "…\n");

  // --- 5: HyDE (разговорный запрос) ---
  console.log("=== 5) HyDE: разговорный вопрос про тревогу ===\n");
  const hyde = buildGraphHyde();
  const conv =
    "I keep replaying awkward conversations in my head for hours. Is that worry or rumination, and what does MCT say?";
  const hydeRes = await hyde.invoke(
    { messages: [new HumanMessage(conv)] },
    threadCfg("hyde-demo")
  );
  console.log(lastAi(hydeRes.messages).slice(0, 800), "…\n");

  // --- 6: Guardrails ---
  console.log("=== 6) Guardrails: PII в логе, оффтоп, инъекция в tool output ===\n");
  const guarded = buildGuardedGraph();

  const g1 = await guarded.invoke(
    {
      messages: [
        new HumanMessage(
          "Хочу записать контакт: паспорт 4506 123456, email ivan@example.com"
        ),
      ],
    },
    threadCfg("guard-pii")
  );
  console.log("[Сценарий PII] ответ:", lastAi(g1.messages).slice(0, 200), "…\n");

  const g2 = await guarded.invoke(
    { messages: [new HumanMessage("Напиши стихотворение про океан")] },
    threadCfg("guard-offtopic")
  );
  console.log("[Оффтоп]", lastAi(g2.messages).slice(0, 250), "…\n");

  const g3 = await guarded.invoke(
    {
      messages: [
        new HumanMessage(
          "Найди в каталоге упражнения по тревоге и беспокойству (ключевые слова: тревога, worry)"
        ),
      ],
    },
    threadCfg("guard-injection")
  );
  console.log(
    "[Инъекция EX-777 отфильтрована — в ответе не должно быть «опасного» упражнения]\n",
    lastAi(g3.messages).slice(0, 700),
    "…\n"
  );

  // --- 7: Human-in-the-loop: домашний план ---
  console.log("=== 7) propose_homework_plan + interrupt + Command(resume) ===\n");
  await saveProfile({
    name: "Иван Петров",
    email: "ivan.petrov@example.com",
    focus_area: "rumination",
  });

  const full = buildFullGraph();
  const bookCfg = threadCfg("homework-demo");

  await full.invoke(
    {
      messages: [
        new HumanMessage(
          "Найди в каталоге практики по руминации и беспокойству"
        ),
      ],
    },
    bookCfg
  );

  await full.invoke(
    {
      messages: [
        new HumanMessage(
          "Предложи домашнее задание на базе ATT-01 для Ивана Петрова, email из профиля"
        ),
      ],
    },
    bookCfg
  );

  let turn = await full.invoke(
    {
      messages: [
        new HumanMessage(
          "Краткое домашнее задание: 10 минут ATT три раза в неделю, записать заметки о фокусе внимания"
        ),
      ],
    },
    bookCfg
  );

  if (isInterrupted(turn)) {
    const payload = turn[INTERRUPT]?.[0]?.value;
    console.log(
      "⏸️ interrupt payload:",
      JSON.stringify(payload, null, 2).slice(0, 800)
    );
    turn = await full.invoke(
      // LangGraph: Command<resume> type несовместим с CompiledStateGraph.invoke() state generics
      new Command({ resume: "approved" }) as never,
      bookCfg
    );
  }

  console.log("\nПосле approve:\n", lastAi(turn.messages).slice(0, 900), "…\n");

  console.log("Готово — все блоки семинара пройдены.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
