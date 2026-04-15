import { buildFullGraph } from "../seminar-graphs";
import { getCheckpointSaver } from "./checkpointer";
import { initCorpusEmbeddings } from "../embeddings/vector-store";

let checkpointerPromise: ReturnType<typeof getCheckpointSaver> | null = null;
const graphCache = new Map<string, ReturnType<typeof buildFullGraph>>();

async function resolveCheckpointer() {
  if (!checkpointerPromise) {
    checkpointerPromise = getCheckpointSaver();
  }
  return checkpointerPromise;
}

/**
 * Возвращает скомпилированный граф для указанной модели.
 * Кэшируется per-modelId; дефолтный ключ — "default".
 */
export async function getFullGraph(modelId?: string) {
  const key = modelId ?? "default";
  if (graphCache.has(key)) return graphCache.get(key)!;

  const checkpointer = await resolveCheckpointer();

  // double-check после await (race condition)
  if (graphCache.has(key)) return graphCache.get(key)!;

  if (graphCache.size === 0) {
    // Fire-and-forget: инициализируем эмбеддинги только один раз
    initCorpusEmbeddings().catch((e) =>
      console.warn("[embeddings] init failed:", e)
    );
  }

  const graph = buildFullGraph(checkpointer, modelId);
  graphCache.set(key, graph);
  return graph;
}
