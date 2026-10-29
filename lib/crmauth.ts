import { env } from "./env";

export const CRM_COOKIE = "va_crm";

export async function crmToken(password: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`veritas-crm:${password}`));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isCrmAuthed(req: Request) {
  const pw = env.crmPassword();
  if (!pw) return false;
  const cookie = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${CRM_COOKIE}=([a-f0-9]{64})`).exec(cookie);
  return !!m && m[1] === (await crmToken(pw));
}
