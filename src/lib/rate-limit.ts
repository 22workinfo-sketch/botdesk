import { NextRequest } from "next/server";
import { prisma } from "./prisma";

interface RateLimitEntry {
  failures: number;
  blockedUntil: number;
}

const memoryRateLimits = new Map<string, RateLimitEntry>();
const MAX_FAILURES = 5;
const BLOCK_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function _clearRateLimitsForTesting(): Promise<void> {
  memoryRateLimits.clear();
  try {
    await prisma.loginRateLimit.deleteMany();
  } catch {
    // ignore in tests without db
  }
}

export function getClientIdentifier(req: NextRequest, email: string): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : "127.0.0.1";
  return `${ip}:${email.toLowerCase().trim()}`;
}

export async function checkLoginRateLimit(
  key: string
): Promise<{ isBlocked: boolean; remainingSec: number }> {
  const now = Date.now();

  // 1. Check persistent PostgreSQL store
  try {
    const record = await prisma.loginRateLimit.findUnique({
      where: { clientKey: key },
    });

    if (record?.blockedUntil) {
      const blockedUntilMs = record.blockedUntil.getTime();
      if (blockedUntilMs > now) {
        const remainingSec = Math.ceil((blockedUntilMs - now) / 1000);
        return { isBlocked: true, remainingSec };
      }
    }
  } catch {
    // Fall back to in-memory store if DB query fails
  }

  // 2. Check in-memory store
  const entry = memoryRateLimits.get(key);
  if (entry) {
    if (entry.blockedUntil > now) {
      const remainingSec = Math.ceil((entry.blockedUntil - now) / 1000);
      return { isBlocked: true, remainingSec };
    }
    if (entry.blockedUntil > 0 && entry.blockedUntil <= now) {
      memoryRateLimits.delete(key);
    }
  }

  return { isBlocked: false, remainingSec: 0 };
}

export async function recordFailedLogin(key: string): Promise<void> {
  const now = Date.now();

  // 1. Update in-memory entry
  const entry = memoryRateLimits.get(key) || { failures: 0, blockedUntil: 0 };
  entry.failures += 1;
  let blockedUntilMs: number | null = null;

  if (entry.failures >= MAX_FAILURES) {
    blockedUntilMs = now + BLOCK_WINDOW_MS;
    entry.blockedUntil = blockedUntilMs;
    console.warn(
      `[Auth RateLimit] Client ${key} blocked for 15 minutes after ${entry.failures} failed attempts.`
    );
  }
  memoryRateLimits.set(key, entry);

  // 2. Persist to PostgreSQL database for cross-instance & restart durability
  try {
    await prisma.loginRateLimit.upsert({
      where: { clientKey: key },
      create: {
        clientKey: key,
        failures: entry.failures,
        blockedUntil: blockedUntilMs ? new Date(blockedUntilMs) : null,
      },
      update: {
        failures: entry.failures,
        blockedUntil: blockedUntilMs ? new Date(blockedUntilMs) : undefined,
      },
    });
  } catch (err) {
    console.error("[Auth RateLimit] Failed to persist rate limit record to DB", err);
  }
}

export async function recordSuccessfulLogin(key: string): Promise<void> {
  memoryRateLimits.delete(key);
  try {
    await prisma.loginRateLimit.deleteMany({
      where: { clientKey: key },
    });
  } catch {
    // ignore DB error on reset
  }
}

/**
 * Parses and returns a set of explicitly trusted hosts (host:port or hostname).
 * Only explicitly configured origins/hosts, direct server host, and local loopbacks are trusted.
 * Arbitrary wildcards (e.g. all *.devtunnels.ms or *.ngrok.io) and unverified
 * X-Forwarded-Host values are strictly rejected to prevent CSRF and host-header injection.
 */
export function getTrustedHosts(directHost?: string | null): Set<string> {
  const trusted = new Set<string>();

  if (directHost) {
    trusted.add(directHost.trim().toLowerCase());
  }

  // Always trust standard local loopbacks
  trusted.add("127.0.0.1:3000");
  trusted.add("localhost:3000");
  trusted.add("127.0.0.1");
  trusted.add("localhost");

  // Explicitly configured trusted origins from environment
  const envSources = [
    process.env.ALLOWED_ORIGINS,
    process.env.APP_URL,
    process.env.WEBHOOK_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ];

  for (const source of envSources) {
    if (!source) continue;
    const items = source.split(",");
    for (const item of items) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      try {
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          const parsed = new URL(trimmed);
          trusted.add(parsed.host.toLowerCase());
        } else {
          trusted.add(trimmed.toLowerCase());
        }
      } catch {
        trusted.add(trimmed.toLowerCase());
      }
    }
  }

  return trusted;
}

export function verifyRequestOrigin(req: NextRequest): { isValid: boolean; error?: string } {
  const directHost = req.headers.get("host");
  const trustedHosts = getTrustedHosts(directHost);

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (!trustedHosts.has(originHost)) {
        console.warn(
          `[Auth CSRF] Rejected request with untrusted origin: origin=${originHost}, host=${directHost}`
        );
        return { isValid: false, error: "Forbidden: Origin verification failed" };
      }
      return { isValid: true };
    } catch {
      return { isValid: false, error: "Forbidden: Invalid origin header format" };
    }
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refererHost = new URL(referer).host.toLowerCase();
      if (!trustedHosts.has(refererHost)) {
        console.warn(
          `[Auth CSRF] Rejected request with untrusted referer: referer=${refererHost}, host=${directHost}`
        );
        return { isValid: false, error: "Forbidden: Referer verification failed" };
      }
      return { isValid: true };
    } catch {
      return { isValid: false, error: "Forbidden: Invalid referer header format" };
    }
  }

  return { isValid: true };
}
