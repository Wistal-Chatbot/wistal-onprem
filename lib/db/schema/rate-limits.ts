import { integer, text, timestamp } from "drizzle-orm/pg-core";

import { chatbot } from "./shared";

export const authRateLimits = chatbot.table("auth_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});

export type AuthRateLimit = typeof authRateLimits.$inferSelect;
