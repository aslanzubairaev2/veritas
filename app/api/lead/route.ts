import { deliverLead, validateLead } from "@/lib/leads";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!rateLimit(`lead:${clientIp(req)}`, 6, 60 * 60_000)) return tooMany();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Ungültige Anfrage" }, { status: 400 });

  // Einwilligung ist immer Pflicht: im Chat per Häkchen, im Gespräch per ausdrücklichem „Ja“ (consent = true)
  const source = body.source === "call" ? "call" : "chat";
  if (body.consent !== true) {
    return Response.json({ error: "Bitte der Kontaktaufnahme zustimmen / Подтвердите согласие" }, { status: 400 });
  }

  const lead = validateLead(body, source);
  if (typeof lead === "string") return Response.json({ error: lead }, { status: 400 });

  try {
    const delivered = await deliverLead(lead);
    return Response.json({ ok: true, delivered });
  } catch (e) {
    console.error("lead error", e);
    return Response.json({ error: "Anfrage konnte nicht gespeichert werden." }, { status: 500 });
  }
}
