import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Если переменных окружения нет (например во время сборки), возвращаем заглушку.
// Иначе инициализируем Upstash Redis limit-ер
let ratelimit: Ratelimit | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  // Limit: 10 requests per minute per IP
  // This is a sliding window rate limit.
  ratelimit = new Ratelimit({
    redis: redis,
    limiter: Ratelimit.slidingWindow(20, "1 m"), 
    analytics: true,
  });
}

/**
 * Ограничение по IP. 
 * Если ratelimit не сконфигурирован, всегда пропускает.
 */
export async function isRateLimited(identifier: string): Promise<boolean> {
  if (!ratelimit) return false;
  try {
    const { success } = await ratelimit.limit(identifier);
    return !success;
  } catch (error) {
    // В случае сбоя Redis - пропускаем, чтобы не блокировать всё
    console.error("[RateLimit] Error:", error);
    return false;
  }
}
