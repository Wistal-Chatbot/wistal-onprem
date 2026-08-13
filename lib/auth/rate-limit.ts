import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/drizzle";

export interface RateLimitOptions {
  /** Logical bucket, e.g. "otp:email" → key becomes rl:otp:email:{key}. */
  namespace: string;
  /** Per-subject identifier, e.g. the email or IP. */
  key: string;
  /** Max allowed hits within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limit backed by Postgres. A single atomic upsert either
 * increments the current window or starts a fresh one, so concurrent requests
 * cannot race past the limit.
 */
export async function checkRateLimit({
  namespace,
  key,
  limit,
  windowSeconds,
}: RateLimitOptions): Promise<RateLimitResult> {
  const bucketKey = `rl:${namespace}:${key}`;
  // Interval literals cannot be parameterised, so the value is coerced to an integer first.
  const window = sql.raw(`interval '${Math.max(1, Math.floor(windowSeconds))} seconds'`);

  const rows = (await db.execute(sql`
    INSERT INTO chatbot.auth_rate_limits (key, count, window_start)
    VALUES (${bucketKey}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN chatbot.auth_rate_limits.window_start < now() - ${window}
        THEN 1
        ELSE chatbot.auth_rate_limits.count + 1
      END,
      window_start = CASE
        WHEN chatbot.auth_rate_limits.window_start < now() - ${window}
        THEN now()
        ELSE chatbot.auth_rate_limits.window_start
      END
    RETURNING
      count,
      GREATEST(0, CEIL(EXTRACT(EPOCH FROM (window_start + ${window}) - now())))::int AS retry_after
  `)) as unknown as Array<{ count: number; retry_after: number }>;

  const count = Number(rows[0].count);
  const retryAfter = Number(rows[0].retry_after);

  if (count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: retryAfter > 0 ? retryAfter : windowSeconds,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: 0,
  };
}
