"use client";

// Gedächtnis auf diesem Gerät, in Sitzungen organisiert.
// Jede Sitzung hat eine eigene Gesprächs-ID (= eigene Kundenkarte im CRM) und einen eigenen Verlauf.
// Nur im Browser der Person; ohne Speicher (privates Fenster) funktioniert die App trotzdem.

export type StoredMsg = { id: string; role: "user" | "assistant"; content: string; call?: boolean; at?: number };
export type Session = { id: string; title: string; created: number; updated: number };

const K_CONV = "va-conv"; // aktuelle Sitzung
const K_SESS = "va-sessions";
const K_HIST = (id: string) => `va-history:${id}`;
const K_OLD_HIST = "va-history"; // Format bis Oktober 2026
const K_DEV = "va-dev";
const MAX = 80;

let memoryConv = "";

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

const valid = (id: string | null): id is string => !!id && /^[\w-]{16,64}$/.test(id);

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function listSessions(): Session[] {
  const list = read<Session[]>(K_SESS, []);
  return Array.isArray(list) ? list.filter((s) => s && valid(s.id)).sort((a, b) => b.updated - a.updated) : [];
}

function upsertSession(id: string, patch: Partial<Session> = {}) {
  const list = listSessions();
  const now = Date.now();
  const i = list.findIndex((s) => s.id === id);
  if (i === -1) list.push({ id, title: "", created: now, updated: now, ...patch });
  else list[i] = { ...list[i], ...patch, updated: patch.updated ?? list[i].updated };
  write(K_SESS, list.slice(0, 30));
}

/** Gesprächs-ID der aktuellen Sitzung – Chat und Anrufe schreiben in dieselbe Kundenkarte. */
export function conversationId(): string {
  try {
    let id = localStorage.getItem(K_CONV);
    if (!valid(id)) {
      id = newId();
      localStorage.setItem(K_CONV, id);
    }
    // Alten Verlauf (ohne Sitzungen) übernehmen
    const old = localStorage.getItem(K_OLD_HIST);
    if (old && !localStorage.getItem(K_HIST(id))) localStorage.setItem(K_HIST(id), old);
    if (old) localStorage.removeItem(K_OLD_HIST);
    if (!listSessions().some((s) => s.id === id)) upsertSession(id);
    return id;
  } catch {
    return (memoryConv ||= newId());
  }
}

export function loadHistory(id = conversationId()): StoredMsg[] {
  const raw = read<StoredMsg[]>(K_HIST(id), []);
  return Array.isArray(raw)
    ? raw.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content)
    : [];
}

export function saveHistory(msgs: StoredMsg[], id = conversationId()) {
  const list = msgs.filter((m) => m.content).slice(-MAX);
  write(K_HIST(id), list);
  if (list.length) {
    const firstUser = list.find((m) => m.role === "user")?.content ?? "";
    upsertSession(id, { title: firstUser.slice(0, 60), updated: list[list.length - 1].at ?? Date.now() });
  }
}

/** Neue, leere Sitzung beginnen (die alte bleibt erhalten). */
export function newSession(): string {
  const id = newId();
  try { localStorage.setItem(K_CONV, id); } catch { memoryConv = id; }
  upsertSession(id);
  return id;
}

export function switchSession(id: string): string {
  if (!valid(id)) return conversationId();
  try { localStorage.setItem(K_CONV, id); } catch { memoryConv = id; }
  return id;
}

export function deleteSession(id: string) {
  try { localStorage.removeItem(K_HIST(id)); } catch {}
  write(K_SESS, listSessions().filter((s) => s.id !== id));
  try { if (localStorage.getItem(K_CONV) === id) localStorage.removeItem(K_CONV); } catch {}
}

/** Alles auf diesem Gerät löschen (Entwickler-Reset). */
export function resetDevice() {
  memoryConv = "";
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("va-") && k !== K_DEV && k !== "va-lang") localStorage.removeItem(k);
  } catch {}
}

/** Entwicklermodus: einmal mit ?dev=1 öffnen (mit ?dev=0 wieder aus). */
export function devMode(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("dev");
    if (q === "1") localStorage.setItem(K_DEV, "1");
    if (q === "0") localStorage.removeItem(K_DEV);
    return localStorage.getItem(K_DEV) === "1";
  } catch {
    return false;
  }
}
