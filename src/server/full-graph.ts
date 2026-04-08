import { buildFullGraph } from "../seminar-graphs";

let instance: ReturnType<typeof buildFullGraph> | undefined;

/** Один compiled graph на процесс сервера (MemorySaver в памяти). */
export function getFullGraph() {
  if (!instance) {
    instance = buildFullGraph();
  }
  return instance;
}
