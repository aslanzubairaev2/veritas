import { env } from "@/lib/env";
import { ACCESS_COOKIE, accessToken } from "@/lib/access";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!rateLimit(`unlock:${clientIp(req)}`, 10, 15 * 60_000)) return tooMany();
  const code = env.accessCode();
  const { code: given } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code || String(given ?? "").trim() !== code) {
    return Response.json({ error: "Falscher Code / Неверный код" }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    `${ACCESS_COOKIE}=${await accessToken(code)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; Secure; SameSite=Lax`,
  );
  return res;
}
