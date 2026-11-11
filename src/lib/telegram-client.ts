import https from "node:https";
import { Api, ApiClientOptions } from "grammy";

/**
 * Reusable HTTPS agent configured with IPv4 priority (`family: 4`) and keepAlive.
 * This prevents Node.js on dual-stack Windows and hybrid networks from hanging
 * or timing out on unreachable IPv6 socket connections to Telegram Bot API.
 */
export const telegramHttpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  timeout: 45000,
});

/**
 * Creates a grammY Api instance configured with IPv4 socket settings and optional overrides.
 */
export function createTelegramApi(
  token: string,
  options?: ApiClientOptions
): Api {
  return new Api(token, {
    baseFetchConfig: { agent: telegramHttpsAgent } as any,
    ...options,
  });
}
