import { buildFullGraph } from "../seminar-graphs";
import { getCheckpointSaver } from "./checkpointer";
import { initCorpusEmbeddings } from "../embeddings/vector-store";

let graphPromise: Promise<ReturnType<typeof buildFullGraph>> | null = null;

/**
 * Один compiled graph на процесс; checkpointer — Postgres при `DATABASE_URL`, иначе MemorySaver.
 */
export async function getFullGraph() {
  if (!graphPromise) {
    graphPromise = (async () => {
      const checkpointer = await getCheckpointSaver();
      // Fire-and-forget инициализация эмбеддингов встроенного корпуса
      initCorpusEmbeddings().catch((e) =>
        console.warn("[embeddings] init failed:", e)
      );
      return buildFullGraph(checkpointer);
    })();
  }
  return graphPromise;
}
