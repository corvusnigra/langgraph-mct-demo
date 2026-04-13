import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestCtx {
  userId?: string;
  sessionId?: string;
  modality?: "mct" | "act";
}

const storage = new AsyncLocalStorage<RequestCtx>();

/**
 * AsyncLocalStorage-based request context.
 * API routes wrap graph.invoke() in requestContext.run() to propagate userId/sessionId
 * into tools and system-prompt builders without threading params through the graph API.
 */
export const requestContext = {
  run<T>(ctx: RequestCtx, fn: () => Promise<T>): Promise<T> {
    return storage.run(ctx, fn);
  },
  get(): RequestCtx {
    return storage.getStore() ?? {};
  },
};
