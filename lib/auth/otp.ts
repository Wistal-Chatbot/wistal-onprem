import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/drizzle";
import { authVerificationTokens } from "@/lib/db/schema";

const OTP_TTL_SECONDS = 10 * 60; // codes expire after 10 minutes
const MAX_ATTEMPTS = 5;

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: "expired" | "mismatch" | "too_many_attempts" };

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
}

/** A 6-digit numeric code, generated with a CSPRNG. */
export function generateOtpCode(): string {
  return randomInt(100000, 1000000).toString();
}

/** Keyed HMAC-SHA256 — codes are never stored in plaintext. */
export function hashOtp(code: string): string {
  return createHmac("sha256", getSecret()).update(code).digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Store a fresh OTP for an email, replacing any previous one. Earlier unused
 * codes are marked used so only the newest code can ever verify.
 */
export async function storeOtp(email: string, code: string): Promise<void> {
  const tokenHash = hashOtp(code);
  await db.transaction(async (tx) => {
    await tx
      .update(authVerificationTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(authVerificationTokens.email, email),
          isNull(authVerificationTokens.usedAt),
        ),
      );
    await tx.insert(authVerificationTokens).values({
      email,
      tokenHash,
      expiresAt: sql`now() + interval '${sql.raw(String(OTP_TTL_SECONDS))} seconds'`,
    });
  });
}

/**
 * Verify a submitted code. On success the OTP is consumed (marked used). On a
 * wrong code the attempt counter is incremented and the OTP is invalidated once
 * the limit is reached, so a code can't be brute-forced within its TTL. Failed
 * attempts never extend the code's expiry.
 */
export async function verifyOtp(
  email: string,
  code: string,
): Promise<VerifyOtpResult> {
  const [stored] = await db
    .select()
    .from(authVerificationTokens)
    .where(
      and(
        eq(authVerificationTokens.email, email),
        isNull(authVerificationTokens.usedAt),
        gt(authVerificationTokens.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(authVerificationTokens.expiresAt))
    .limit(1);

  if (!stored) {
    return { ok: false, reason: "expired" };
  }

  if (hashesMatch(stored.tokenHash, hashOtp(code))) {
    await db
      .update(authVerificationTokens)
      .set({ usedAt: sql`now()` })
      .where(eq(authVerificationTokens.id, stored.id));
    return { ok: true };
  }

  const attempts = stored.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await db
      .update(authVerificationTokens)
      .set({ attempts, usedAt: sql`now()` })
      .where(eq(authVerificationTokens.id, stored.id));
    return { ok: false, reason: "too_many_attempts" };
  }

  await db
    .update(authVerificationTokens)
    .set({ attempts })
    .where(eq(authVerificationTokens.id, stored.id));
  return { ok: false, reason: "mismatch" };
}
