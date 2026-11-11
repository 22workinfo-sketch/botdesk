import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Check database connection by reading bot count
    const botCount = await prisma.bot.count();

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "backstage-admin-api",
      version: "0.1.0",
      database: {
        status: "connected",
        registeredBots: botCount,
      },
    });
  } catch (error) {
    const sanitizedError =
      error instanceof Error ? error.message : "Database connection failed";

    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: sanitizedError,
      },
      { status: 503 }
    );
  }
}
