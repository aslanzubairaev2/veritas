import { env } from "./env";
import { getTenant } from "./tenant";

export type Lead = {
  name: string;
  phone: string;
  district?: string;
  concern?: string;
  language?: string;
  source: "chat" | "call";
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
  };
}

/** Speichert die Anfrage überall, wo es konfiguriert ist. Gibt zurück, wohin. */
export async function deliverLead(lead: Lead): Promise<string[]> {
  const delivered: string[] = [];
  const { company } = getTenant();

  if (env.supabaseUrl() && env.supabaseKey()) {
    const key = env.supabaseKey();
    const headers: Record<string, string> = {
      apikey: key,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };
    // Alte JWT-Schlüssel (service_role/anon) brauchen zusätzlich den Authorization-Header
    if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`${env.supabaseUrl()}/rest/v1/leads`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...lead, company_id: company.id }),
    });
    if (res.ok) delivered.push("supabase");
    else console.error("Supabase lead insert failed", res.status, (await res.text()).slice(0, 300));
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
