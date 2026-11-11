import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { safeFetchJson } from "../src/lib/api-client";
import { verifyRequestOrigin } from "../src/lib/rate-limit";
import { NextRequest } from "next/server";

describe("Safe API Client & CSRF Dev Tunnel Verification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("safeFetchJson", () => {
    it("handles 204 No Content without throwing 'Unexpected end of JSON input'", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
      } as any);

      const res = await safeFetchJson("/api/test");
      expect(res.ok).toBe(true);
      expect(res.status).toBe(204);
      expect(res.data).toEqual({});
    });

    it("handles non-JSON 403 Forbidden without throwing JSON parse error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => "Forbidden: Origin verification failed",
      } as any);

      const res = await safeFetchJson("/api/test");
      expect(res.ok).toBe(false);
      expect(res.status).toBe(403);
      expect(res.error).toContain("Forbidden");
    });

    it("parses valid JSON response cleanly", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ success: true, count: 42 }),
      } as any);

      const res = await safeFetchJson<{ success: boolean; count: number }>("/api/data");
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.data?.count).toBe(42);
    });

    it("surfaces validationErrors from API error payload", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () =>
          JSON.stringify({
            error: "Validation failed",
            validationErrors: ["Root menu has no buttons", "Target menu not found"],
          }),
      } as any);

      const res = await safeFetchJson("/api/publish");
      expect(res.ok).toBe(false);
      expect(res.validationErrors).toEqual([
        "Root menu has no buttons",
        "Target menu not found",
      ]);
    });

    it("handles network error gracefully without unhandled rejection", async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      const res = await safeFetchJson("/api/network-down");
      expect(res.ok).toBe(false);
      expect(res.status).toBe(0);
      expect(res.error).toContain("Network connection error");
    });
  });

  describe("verifyRequestOrigin with Dev Tunnels & Strict Host Whitelisting", () => {
    const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

    afterEach(() => {
      if (originalAllowedOrigins === undefined) {
        delete process.env.ALLOWED_ORIGINS;
      } else {
        process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
      }
    });

    it("allows devtunnel.ms origin when explicitly configured in ALLOWED_ORIGINS", () => {
      process.env.ALLOWED_ORIGINS = "https://7761tcb-3000.asse.devtunnels.ms";

      const req = new NextRequest("http://127.0.0.1:3000/api/posts/upload", {
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://7761tcb-3000.asse.devtunnels.ms",
          "x-forwarded-host": "7761tcb-3000.asse.devtunnels.ms",
        },
      });

      const check = verifyRequestOrigin(req);
      expect(check.isValid).toBe(true);
    });

    it("rejects untrusted devtunnel.ms subdomain not configured in whitelist (anti-spoofing)", () => {
      delete process.env.ALLOWED_ORIGINS;

      const req = new NextRequest("http://127.0.0.1:3000/api/posts/upload", {
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://attacker-random-subdomain.devtunnels.ms",
          "x-forwarded-host": "attacker-random-subdomain.devtunnels.ms",
        },
      });

      const check = verifyRequestOrigin(req);
      expect(check.isValid).toBe(false);
      expect(check.error).toContain("Origin verification failed");
    });

    it("rejects spoofed X-Forwarded-Host from untrusted attacker", () => {
      process.env.ALLOWED_ORIGINS = "https://7761tcb-3000.asse.devtunnels.ms";

      const req = new NextRequest("http://127.0.0.1:3000/api/posts/upload", {
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://attacker.evil.com",
          "x-forwarded-host": "attacker.evil.com",
        },
      });

      const check = verifyRequestOrigin(req);
      expect(check.isValid).toBe(false);
      expect(check.error).toContain("Origin verification failed");
    });

    it("rejects untrusted third-party attacker origin", () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/posts/upload", {
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://malicious-phishing-site.com",
        },
      });

      const check = verifyRequestOrigin(req);
      expect(check.isValid).toBe(false);
      expect(check.error).toContain("Origin verification failed");
    });
  });
});
