import { getLead } from "@/lib/crmdb";
import { convFrom } from "@/lib/memory";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Eigene Anfrage zu der Gesprächs-ID dieses Geräts (Hinweis „Ihre Anfrage Nr. …“, vorausgefülltes Formular)
export async function POST(req: Request) {
  if (!rateLimit(`me:${clientIp(req)}`, 60, 10 * 60_000)) return tooMany();
  const body = (await req.json().catch(() => null)) as { conversationId?: unknown } | null;
  const conv = convFrom(body?.conversationId);
  const lead = conv ? await getLead(conv) : null;
  const out = lead
    ? { id: lead.id, name: lead.name, phone: lead.phone, district: lead.district, status: lead.status, consent: lead.consent }
    : null;
  return Response.json({ lead: out }, { headers: { "Cache-Control": "no-store" } });
}
