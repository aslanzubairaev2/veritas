import { env } from "./env";
import { getTenant } from "./tenant";

// Zugriff auf die gemeinsame Datenbank „Assistants“ (Supabase) – nur über geprüfte Funktionen.
// Jede Funktion prüft den geheimen Firmenschlüssel CRM_DB_KEY, deshalb reicht der Publishable Key.

export function crmConfigured() {
  return !!(env.supabaseUrl() && env.supabaseKey() && env.crmDbKey());
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const key = env.supabaseKey();
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${env.supabaseUrl()}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ p_company: getTenant().company.id, p_key: env.crmDbKey(), ...args }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`db ${fn} ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export type CardData = {
  name?: string;
  phone?: string;
  district?: string;
  relation?: string;
  care_level?: string;
  needs?: string;
  concern?: string;
  note?: string;
  language?: string;
  consent?: boolean;
};

export const upsertCard = (conversationId: string, source: "call" | "chat", data: CardData) =>
  rpc<number>("agent_upsert_lead", { p_conversation: conversationId, p_source: source, p_data: data });

export const addTask = (conversationId: string, source: "call" | "chat", title: string, due?: string) =>
  rpc<number>("agent_add_task", { p_conversation: conversationId, p_source: source, p_title: title, p_due: due ?? "" });

export const snapshot = () => rpc<{ leads: unknown[]; tasks: unknown[]; events: unknown[] }>("crm_snapshot", {});

export const crmUpdate = (kind: "lead_status" | "task_done", id: number, value: string) =>
  rpc<null>("crm_update", { p_kind: kind, p_id: id, p_value: value });
