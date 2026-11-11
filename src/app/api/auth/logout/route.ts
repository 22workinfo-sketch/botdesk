import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { verifyRequestOrigin } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const originCheck = verifyRequestOrigin(req);
  if (!originCheck.isValid) {
    return NextResponse.json(
      { error: originCheck.error || "Forbidden" },
      { status: 403 }
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete(COOKIE_NAME);
  return response;
}
