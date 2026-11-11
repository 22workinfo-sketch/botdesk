import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
} from "../src/lib/auth";

describe("Admin Authentication & Password Lifecycle (In-Memory / Logic Mocks)", () => {
  it("should securely hash and verify passwords using bcrypt", async () => {
    const rawPassword = "disposable_test_password_initial_123";
    const hash = await hashPassword(rawPassword);

    expect(hash).not.toBe(rawPassword);
    expect(hash.startsWith("$2")).toBe(true); // bcrypt prefix

    const isValid = await verifyPassword(rawPassword, hash);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPassword("wrong_password", hash);
    expect(isInvalid).toBe(false);
  });

  it("should verify old/new password replacement behavior using disposable credentials", async () => {
    const initialDisposablePassword = "old_disposable_pass_123";
    const newDisposablePassword = "new_disposable_pass_456";

    // 1. Initial password hash
    let storedHash = await hashPassword(initialDisposablePassword);
    expect(await verifyPassword(initialDisposablePassword, storedHash)).toBe(true);
    expect(await verifyPassword(newDisposablePassword, storedHash)).toBe(false);

    // 2. Perform password update (simulate update script)
    storedHash = await hashPassword(newDisposablePassword);

    // 3. Verify old password fails and new password passes
    expect(await verifyPassword(initialDisposablePassword, storedHash)).toBe(false);
    expect(await verifyPassword(newDisposablePassword, storedHash)).toBe(true);
  }, 15000);

  it("should create and verify valid session tokens using jose JWT", async () => {
    const sessionData = {
      id: "admin-uuid-123",
      email: "admin@local.test",
      role: "SUPER_ADMIN",
    };

    const token = await createSessionToken(sessionData);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);

    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.id).toBe(sessionData.id);
    expect(payload?.email).toBe(sessionData.email);
    expect(payload?.role).toBe(sessionData.role);
  });

  it("should reject tampered or invalid session tokens", async () => {
    const invalidToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tampered.token";
    const payload = await verifySessionToken(invalidToken);
    expect(payload).toBeNull();
  });
});
