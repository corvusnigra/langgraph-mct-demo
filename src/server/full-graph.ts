import { buildFullGraph } from "../seminar-graphs";
import { getCheckpointSaver } from "./checkpointer";

let graphPromise: Promise<ReturnType<typeof buildFullGraph>> | null = null;

/**
 * Один compiled graph на процесс; checkpointer — Postgres при `DATABASE_URL`, иначе MemorySaver.
 */
export async function getFullGraph() {
  if (!graphPromise) {
    graphPromise = (async () => {
      const checkpointer = await getCheckpointSaver();
      return buildFullGraph(checkpointer);
    })();
  }
  return graphPromise;
}
