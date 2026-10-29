import { env } from "@/lib/env";
import { CRM_COOKIE, crmToken } from "@/lib/crmauth";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!rateLimit(`crmlogin:${clientIp(req)}`, 10, 15 * 60_000)) return tooMany();
  const pw = env.crmPassword();
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!pw || String(password ?? "").trim() !== pw) return Response.json({ error: "wrong" }, { status: 401 });
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${CRM_COOKIE}=${await crmToken(pw)}; Path=/; Max-Age=${60 * 60 * 24 * 14}; HttpOnly; Secure; SameSite=Lax`);
  return res;
}
