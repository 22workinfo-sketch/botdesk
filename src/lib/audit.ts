import { prisma } from "./prisma";

export interface AuditLogOptions {
  action: string;
  adminUserId?: string | null;
  botId?: string | null;
  details?: Record<string, any> | null;
}

const REDACTED_KEYS = new Set([
  "password",
  "passwordhash",
  "oldpassword",
  "newpassword",
  "secret",
  "token",
  "tokensecret",
  "adminsessionsecret",
  "telegrambottoken",
  "telegramphno",
  "phonenumber",
  "clipboard",
]);

function sanitizeDetails(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeDetails);

  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (REDACTED_KEYS.has(lowerKey)) {
      clean[key] = "[REDACTED]";
    } else if (val && typeof val === "object") {
      clean[key] = sanitizeDetails(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

export async function recordAuditLog(options: AuditLogOptions) {
  try {
    const cleanDetails = options.details ? sanitizeDetails(options.details) : undefined;
    return await prisma.auditLog.create({
      data: {
        action: options.action,
        adminUserId: options.adminUserId || null,
        botId: options.botId || null,
        details: cleanDetails || undefined,
      },
    });
  } catch (err) {
    // Fail-open for audit log persistence errors so primary actions are not blocked
    console.error("[AuditLog Error]", err);
    return null;
  }
}
