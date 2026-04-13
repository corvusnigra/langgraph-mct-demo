import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { getDatabaseUrl } from "./database-url";
import { setupDbSchema } from "./db-schema";

let cached: BaseCheckpointSaver | null = null;
let initPromise: Promise<BaseCheckpointSaver> | null = null;

/**
 * Возвращает персистентный checkpointer при строке подключения к Postgres, иначе `MemorySaver`.
 * Строка ищется через {@link getDatabaseUrl} (`DATABASE_URL`, `POSTGRES_URL`, `STORAGE_URL`, …).
 * Для Postgres вызывается `setup()` один раз на процесс.
 */
export async function getCheckpointSaver(): Promise<BaseCheckpointSaver> {
  if (cached) return cached;
  if (!initPromise) {
    initPromise = (async () => {
      const url = getDatabaseUrl();
      if (!url) {
        console.log(
          "[checkpointer] строка подключения к Postgres не задана — используется MemorySaver (не подходит для multi-instance)."
        );
        cached = new MemorySaver();
        return cached;
      }
      const { PostgresSaver } = await import(
        "@langchain/langgraph-checkpoint-postgres"
      );
      const saver = PostgresSaver.fromConnString(url);
      
      // Инициализируем схемы обоих модулей в рамках единого Promise
      await Promise.all([
        saver.setup(),
        setupDbSchema()
      ]);

      console.log("[checkpointer] PostgresSaver и схема MCT инициализированы.");
      cached = saver;
      return cached;
    })();
  }
  return initPromise;
}
