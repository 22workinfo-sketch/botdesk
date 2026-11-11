import { describe, it, expect } from "vitest";
import { GET as healthCheckGET } from "../src/app/api/health/route";
import { PUT as botConfigPUT } from "../src/app/api/bots/[id]/config/route";
import { GET as botUsersGET } from "../src/app/api/bots/[id]/users/route";
import { GET as botMenuGET, PUT as botMenuPUT } from "../src/app/api/bots/[id]/menu/route";
import { NextRequest } from "next/server";

describe("API Security & Health Check Endpoints (Mixed: Real DB for Health, Mock Request for Guards)", () => {
  it("GET /api/health should return 200 with healthy database status (Uses Real PostgreSQL)", async () => {
    const response = await healthCheckGET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("healthy");
    expect(body.database.status).toBe("connected");
    expect(body.database.registeredBots).toBeGreaterThanOrEqual(1);
  });

  it("PUT /api/bots/[id]/config should reject unauthenticated requests with 401 (Uses Mock NextRequest)", async () => {
    const fakeRequest = new NextRequest("http://127.0.0.1:3000/api/bots/fake-id/config", {
      method: "PUT",
      body: JSON.stringify({ welcomeMessage: "New message" }),
    });

    const response = await botConfigPUT(fakeRequest, { params: { id: "fake-id" } });
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
    expect(body.config).toBeUndefined();
  });

  it("GET /api/bots/[id]/users should reject unauthenticated requests with 401 and not leak user list or phone numbers (Uses Mock NextRequest)", async () => {
    const fakeRequest = new NextRequest("http://127.0.0.1:3000/api/bots/fake-id/users", {
      method: "GET",
    });

    const response = await botUsersGET(fakeRequest, { params: { id: "fake-id" } });
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
    expect(body.users).toBeUndefined(); // Guarantees zero user profile or phone numbers leaked
  });

  it("GET /api/bots/[id]/menu should reject unauthenticated requests with 401 (Uses Mock NextRequest)", async () => {
    const fakeRequest = new NextRequest("http://127.0.0.1:3000/api/bots/fake-id/menu", {
      method: "GET",
    });

    const response = await botMenuGET(fakeRequest, { params: { id: "fake-id" } });
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
    expect(body.buttons).toBeUndefined();
  });

  it("PUT /api/bots/[id]/menu should reject unauthenticated requests with 401 (Uses Mock NextRequest)", async () => {
    const fakeRequest = new NextRequest("http://127.0.0.1:3000/api/bots/fake-id/menu", {
      method: "PUT",
      body: JSON.stringify({ buttons: [] }),
    });

    const response = await botMenuPUT(fakeRequest, { params: { id: "fake-id" } });
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
    expect(body.buttons).toBeUndefined();
  });
});
