import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";

let cached: BaseCheckpointSaver | null = null;
let initPromise: Promise<BaseCheckpointSaver> | null = null;

/**
 * Возвращает персистентный checkpointer при `DATABASE_URL`, иначе `MemorySaver` (локально / без БД).
 * Для Postgres вызывается `setup()` один раз на процесс.
 */
export async function getCheckpointSaver(): Promise<BaseCheckpointSaver> {
  if (cached) return cached;
  if (!initPromise) {
    initPromise = (async () => {
      const url = process.env.DATABASE_URL?.trim();
      if (!url) {
        console.log(
          "[checkpointer] DATABASE_URL не задан — используется MemorySaver (не подходит для multi-instance)."
        );
        cached = new MemorySaver();
        return cached;
      }
      const { PostgresSaver } = await import(
        "@langchain/langgraph-checkpoint-postgres"
      );
      const saver = PostgresSaver.fromConnString(url);
      await saver.setup();
      console.log("[checkpointer] PostgresSaver инициализирован.");
      cached = saver;
      return cached;
    })();
  }
  return initPromise;
}
