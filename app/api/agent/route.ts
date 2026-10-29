import { addTask, crmConfigured, upsertCard, type CardData } from "@/lib/crmdb";
import { errText } from "@/lib/gemini";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Werkzeuge des Sprachassistenten: schreiben während des Gesprächs echt in die CRM-Datenbank.
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : undefined);

export async function POST(req: Request) {
  if (!crmConfigured()) return Response.json({ ok: false, error: "crm_not_configured" }, { status: 503 });
  if (!rateLimit(`agent:${clientIp(req)}`, 120, 10 * 60_000)) return tooMany();

  const body = (await req.json().catch(() => null)) as Record<string, any> | null;
  const conversationId = clip(body?.conversationId, 64);
  if (!body || !conversationId || !/^[\w-]{8,64}$/.test(conversationId)) {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const source = body.source === "chat" ? "chat" : "call";
  const a = (body.args ?? {}) as Record<string, unknown>;
  const t0 = Date.now();

  try {
    if (body.action === "card") {
      const consent = a.consent === true;
      const data: CardData = {
        district: clip(a.district, 80),
        relation: clip(a.relation, 120),
        care_level: clip(a.care_level, 40),
        needs: clip(a.needs, 400),
        concern: clip(a.concern, 400),
        note: clip(a.note, 400),
        language: clip(a.language, 10),
      };
      // Ohne Einwilligung wird nichts gespeichert – das Modell bekommt eine klare Rückmeldung
      if (!consent) {
        return Response.json({
          ok: false,
          error: "consent_required",
          hint: "NICHTS gespeichert. Erst kurz fragen, ob die Angaben notiert werden dürfen; nach dem Ja mit consent=true erneut aufrufen. Jetzt normal weitersprechen.",
        });
      }
      data.name = clip(a.name, 80);
      data.phone = clip(a.phone, 40)?.replace(/[^\d+()\s/-]/g, "");
      data.consent = true;
      const id = await upsertCard(conversationId, source, data);
      return Response.json({ ok: true, id, ms: Date.now() - t0 });
    }
    if (body.action === "task") {
      const title = clip(a.title, 200);
      if (!title || title.length < 2) return Response.json({ ok: false, error: "title_missing" }, { status: 400 });
      const id = await addTask(conversationId, source, title, clip(a.due, 80));
      return Response.json({ ok: true, id, ms: Date.now() - t0 });
    }
    return Response.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (e) {
    console.error("agent db error:", errText(e));
    return Response.json({ ok: false, error: "db_error" }, { status: 502 });
  }
}
