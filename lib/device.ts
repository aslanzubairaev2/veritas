"use client";

// Gedächtnis auf diesem Gerät: Gesprächs-ID (verknüpft mit der Kundenkarte im CRM) und Verlauf.
// Alles nur im Browser der Person; ohne Speicher (privates Fenster) funktioniert die App trotzdem.

export type StoredMsg = { id: string; role: "user" | "assistant"; content: string; call?: boolean; at?: number };

const K_CONV = "va-conv";
const K_HIST = "va-history";
const MAX = 80;

let memoryConv = "";

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

/** Dauerhafte Gesprächs-ID dieses Geräts – Chat und Anrufe schreiben in dieselbe Kundenkarte. */
export function conversationId(): string {
  try {
    let id = localStorage.getItem(K_CONV);
    if (!id || !/^[\w-]{16,64}$/.test(id)) {
      id = newId();
      localStorage.setItem(K_CONV, id);
    }
    return id;
  } catch {
    return (memoryConv ||= newId());
  }
}

export function loadHistory(): StoredMsg[] {
  try {
    const raw = JSON.parse(localStorage.getItem(K_HIST) || "[]");
    return Array.isArray(raw)
      ? raw.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content)
      : [];
  } catch {
    return [];
  }
}

export function saveHistory(msgs: StoredMsg[]) {
  try {
    localStorage.setItem(K_HIST, JSON.stringify(msgs.filter((m) => m.content).slice(-MAX)));
  } catch {}
}

/** „Neues Gespräch“: Verlauf löschen und Verbindung zur bisherigen Anfrage lösen. */
export function forgetDevice() {
  memoryConv = "";
  try {
    localStorage.removeItem(K_HIST);
    localStorage.removeItem(K_CONV);
  } catch {}
}
