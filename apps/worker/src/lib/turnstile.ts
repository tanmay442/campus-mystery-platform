/** Turnstile bot-check helper: verify a token against siteverify, open when unconfigured. */
import { z } from "zod";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const siteverifyResponseSchema = z
  .object({ success: z.boolean() })
  .catchall(z.unknown());

export function turnstileRequired(env: {
  TURNSTILE_SECRET_KEY?: string;
}): boolean {
  const secret = env.TURNSTILE_SECRET_KEY ?? "";
  return secret.trim().length > 0;
}

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | undefined,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp !== undefined && remoteIp.length > 0) {
    body.set("remoteip", remoteIp);
  }
  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, { method: "POST", body });
  } catch {
    return false;
  }
  if (response.ok === false) {
    return false;
  }
  const payload: unknown = await response.json().catch(() => undefined);
  const parsed = siteverifyResponseSchema.safeParse(payload);
  if (parsed.success === false) {
    return false;
  }
  return parsed.data.success;
}
