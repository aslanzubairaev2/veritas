import { env } from "./env";
import { getTenant } from "./tenant";
import { addTask, crmConfigured, upsertCard } from "./crmdb";

export type Lead = {
  name: string;
  phone: string;
  district?: string;
  concern?: string;
  language?: string;
  source: "chat" | "call";
  conversationId?: string;
};

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

export function validateLead(input: Record<string, unknown>, source: Lead["source"]): Lead | string {
  const name = clip(input.name, 80);
  const phone = clip(input.phone, 40).replace(/[^\d+()\s/-]/g, "");
  if (name.length < 2) return "Bitte Namen angeben / Укажите имя";
  if (phone.replace(/\D/g, "").length < 6) return "Bitte gültige Telefonnummer angeben / Укажите номер телефона";
  return {
    name,
    phone,
    district: clip(input.district, 80) || undefined,
    concern: clip(input.concern, 400) || undefined,
    language: clip(input.language, 10) || undefined,
    source,
    conversationId: /^[\w-]{8,64}$/.test(String(input.conversationId ?? "")) ? String(input.conversationId) : undefined,
  };
}

/** Speichert die Anfrage überall, wo es konfiguriert ist. Gibt zurück, wohin. */
export async function deliverLead(lead: Lead): Promise<string[]> {
  const delivered: string[] = [];
  const { company } = getTenant();

  // CRM-Datenbank (Karte + Aufgabe „Rückruf“), alle Firmen in einer Datenbank, getrennt über company_id
  if (crmConfigured()) {
    try {
      const conv = lead.conversationId || `form-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await upsertCard(conv, lead.source, {
        name: lead.name,
        phone: lead.phone,
        district: lead.district,
        concern: lead.concern,
        language: lead.language,
        consent: true,
      });
      await addTask(conv, lead.source, "Rückruf vereinbaren", "Bürozeiten");
      delivered.push("crm");
    } catch (e) {
      console.error("CRM lead failed", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }

  if (env.telegramToken() && env.telegramChat()) {
    const text = [
      `🆕 Rückruf-Anfrage (${company.shortName}, ${lead.source === "call" ? "Sprachassistent" : "Chat"})`,
      `Name: ${lead.name}`,
      `Telefon: ${lead.phone}`,
      lead.district ? `Bezirk: ${lead.district}` : "",
      lead.concern ? `Anliegen: ${lead.concern}` : "",
      lead.language ? `Sprache: ${lead.language}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const res = await fetch(`https://api.telegram.org/bot${env.telegramToken()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.telegramChat(), text }),
    });
    if (res.ok) delivered.push("telegram");
    else console.error("Telegram notify failed", res.status);
  }

  if (!delivered.length) {
    // Ohne Speicher: wenigstens im Vercel-Log sichtbar
    console.log("LEAD (kein Speicher konfiguriert):", JSON.stringify(lead));
    delivered.push("log");
  }
  return delivered;
}
