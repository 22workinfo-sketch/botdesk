import crypto from "crypto";

const TOKEN_REGEX = /\d{8,12}:[A-Za-z0-9_-]{30,45}/g;

/**
 * Returns the 32-byte AES-256 key from environment variable.
 * Fallback to SHA256(ADMIN_SESSION_SECRET) in development/test if not set.
 */
export function getEncryptionKey(): Buffer {
  const envKey = process.env.BOT_TOKEN_ENCRYPTION_KEY?.trim();

  if (envKey) {
    if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
      return Buffer.from(envKey, "hex");
    }
    if (envKey.length === 32) {
      return Buffer.from(envKey, "utf-8");
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[Security Error] BOT_TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) in production."
    );
  }

  // Safe development/test fallback derived deterministically
  const seed = process.env.ADMIN_SESSION_SECRET || "backstage_local_dev_token_key_seed";
  return crypto.createHash("sha256").update(seed + ":bot_token_enc").digest();
}

/**
 * Encrypts a plaintext Telegram bot token using AES-256-GCM.
 * Output format: enc:v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>
 */
export function encryptBotToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Cannot encrypt empty bot token.");
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(trimmed, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag(); // 128-bit authentication tag

  return `enc:v1:${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypts an encrypted Telegram bot token string using AES-256-GCM.
 */
export function decryptBotToken(encryptedString: string): string {
  if (!encryptedString || !encryptedString.startsWith("enc:v1:")) {
    throw new Error("Invalid or unsupported encrypted token format.");
  }

  const parts = encryptedString.split(":");
  if (parts.length !== 5) {
    throw new Error("Malformed encrypted token payload.");
  }

  const [, version, ivHex, authTagHex, cipherHex] = parts;
  if (version !== "v1") {
    throw new Error(`Unsupported token encryption version: ${version}`);
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(cipherHex, "hex");

  if (iv.length !== 12 || authTag.length !== 16) {
    throw new Error("Corrupted encryption parameters (invalid IV or auth tag length).");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (err) {
    throw new Error(
      "Failed to decrypt bot token: Authentication tag mismatch or corrupted ciphertext."
    );
  }
}

/**
 * Extracts numeric Telegram Bot ID from token format: "<bot_id>:<token_secret>".
 */
export function extractTelegramBotId(token: string): string | null {
  const trimmed = token.trim();
  const match = trimmed.match(/^(\d{8,12}):/);
  return match ? match[1] : null;
}

/**
 * Validates Telegram Bot token syntax without network calls.
 */
export function validateTelegramTokenFormat(token: string): {
  isValid: boolean;
  error?: string;
} {
  const trimmed = (token || "").trim();
  if (!trimmed) {
    return { isValid: false, error: "Bot token is required." };
  }

  if (!/^\d{8,12}:[A-Za-z0-9_-]{30,45}$/.test(trimmed)) {
    return {
      isValid: false,
      error:
        "Invalid token format. A Telegram bot token consists of 8-12 digits, followed by a colon, and 30-45 alphanumeric characters (e.g. 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ).",
    };
  }

  return { isValid: true };
}

/**
 * Generates a safe masked representation of a token for UI display.
 * E.g. "••••Chqk"
 */
export function maskBotToken(token: string | null | undefined): string {
  if (!token) return "";
  const trimmed = token.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/**
 * Redacts any full Telegram bot tokens from logs, error strings, and audit descriptions.
 */
export function redactTokens(input: string): string {
  if (!input) return "";
  let sanitized = input.replace(TOKEN_REGEX, "[REDACTED_BOT_TOKEN]");

  const envKey = process.env.BOT_TOKEN_ENCRYPTION_KEY?.trim();
  if (envKey && envKey.length > 8) {
    sanitized = sanitized.split(envKey).join("[REDACTED_ENCRYPTION_KEY]");
  }

  return sanitized;
}

export interface VerifyTokenResult {
  ok: boolean;
  botId?: string;
  username?: string;
  firstName?: string;
  error?: string;
}

/**
 * Verifies a bot token using Telegram getMe API.
 * Accepts optional custom fetch for offline/mock testing.
 */
export async function verifyTelegramToken(
  token: string,
  options?: { customFetch?: typeof fetch }
): Promise<VerifyTokenResult> {
  const formatCheck = validateTelegramTokenFormat(token);
  if (!formatCheck.isValid) {
    return { ok: false, error: formatCheck.error };
  }

  const fetchFn = options?.customFetch || fetch;
  const url = `https://api.telegram.org/bot${token}/getMe`;

  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      const description =
        data.description ||
        `Telegram API error (HTTP ${res.status}: ${res.statusText})`;
      return {
        ok: false,
        error: redactTokens(`Token verification failed: ${description}`),
      };
    }

    const botInfo = data.result;
    return {
      ok: true,
      botId: String(botInfo.id),
      username: botInfo.username,
      firstName: botInfo.first_name,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return {
      ok: false,
      error: redactTokens(`Could not reach Telegram API: ${msg}`),
    };
  }
}
