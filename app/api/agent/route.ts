import { addTask, crmConfigured, getLead, revokeConsent, upsertCard, type CardData } from "@/lib/crmdb";
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
      // Speichern nur, wenn die Einwilligung vorher eigens festgehalten wurde (record_consent oder Formular)
      const consent = (await getLead(conversationId))?.consent === true;
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
          hint: "NICHTS gespeichert. Stell jetzt die Einwilligungsfrage; nach einem eindeutigen Ja record_consent aufrufen, dann erneut speichern.",
        });
      }
      data.name = clip(a.name, 80);
      data.phone = clip(a.phone, 40)?.replace(/[^\d+()\s/-]/g, "");
      data.consent = true;
      const id = await upsertCard(conversationId, source, data);
      return Response.json({ ok: true, id, ms: Date.now() - t0 });
    }
    if (body.action === "consent") {
      const granted = a.granted === true;
      const words = clip(a.words, 200) ?? "";
      const when = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
      const lead = await getLead(conversationId);
      if (granted) {
        const id = await upsertCard(conversationId, source, {
          consent: true,
          language: clip(a.language, 10),
          note: `Einwilligung zur Speicherung erteilt (${source === "call" ? "mündlich im Anruf" : "im Chat"}, ${when}): „${words}“`,
        });
        return Response.json({ ok: true, id, consent: true });
      }
      // Nein oder Widerruf: Einwilligung zurücknehmen, Name/Telefon sofort entfernen
      if (lead) await revokeConsent(conversationId, `Einwilligung abgelehnt/widerrufen (${when}): „${words}“ – übrige Angaben bitte löschen.`);
      return Response.json({ ok: true, consent: false, note: "Nichts mehr speichern; allgemein weiterberaten." });
    }
    if (body.action === "task") {
      if ((await getLead(conversationId))?.consent !== true) {
        return Response.json({ ok: false, error: "consent_required", hint: "Erst Einwilligung einholen (record_consent)." });
      }
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
