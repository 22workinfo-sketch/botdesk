import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getBotUsers } from "@/lib/bot-service";
import { hasBotAccess, canUserViewPhoneNumbers } from "@/lib/permissions";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const session = await getAdminSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await Promise.resolve(params);

    const hasAccess = await hasBotAccess(session, id);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Forbidden: You do not have access to this bot's user list." },
        { status: 403 }
      );
    }

    const isPhoneAllowed = await canUserViewPhoneNumbers(session, id);
    const users = await getBotUsers(id);

    // Convert BigInt telegramId to string for JSON serialization
    // Redact sensitive personal phone numbers if not authorized
    const serializedUsers = users.map((user) => ({
      ...user,
      telegramId: user.telegramId.toString(),
      telegramPhNo: isPhoneAllowed
        ? user.telegramPhNo
        : user.telegramPhNo
        ? "[REDACTED]"
        : null,
    }));

    return NextResponse.json({
      success: true,
      users: serializedUsers,
      phonesRedacted: !isPhoneAllowed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
