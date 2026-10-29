import { GoogleGenAI } from "@google/genai";
import { env } from "./env";

// Zwei Wege zu Gemini mit demselben Google-Schlüssel:
//  - "vertex": Vertex AI (Google Cloud, eigene Kapazität, Schlüssel im Format „AQ.…“)
//  - "studio": Gemini Developer API (Google AI Studio)
// Text, Vorlesen und Spracherkennung versuchen zuerst Vertex, dann AI Studio.
// Das Live-Gespräch läuft immer über AI Studio (Einmal-Schlüssel gibt es nur dort).

export type Backend = "vertex" | "studio";
type Entry = { backend: Backend; ai: GoogleGenAI };

const cache = new Map<string, GoogleGenAI>();
/** Wenn Vertex den Schlüssel ablehnt, merken wir uns das für 10 Minuten. */
let vertexBlockedUntil = 0;

function client(backend: Backend): GoogleGenAI {
  const key = backend === "vertex" ? env.vertexKey() : env.geminiKey();
  if (!key) throw new Error("NO_KEY");
  const id = `${backend}:${key}`;
  let ai = cache.get(id);
  if (!ai) {
    const baseUrl = (process.env.GEMINI_BASE_URL ?? "").trim(); // nur für Tests
    ai =
      backend === "vertex"
        ? new GoogleGenAI({ vertexai: true, apiKey: key, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) })
        : new GoogleGenAI({ apiKey: key, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
    cache.set(id, ai);
  }
  return ai;
}

/** AI-Studio-Client (für das Live-Gespräch und als Rückfall). */
export function gemini(): GoogleGenAI {
  return client("studio");
}

/** Reihenfolge der Wege für Text/Audio. */
export function backends(): Entry[] {
  const mode = env.textBackend();
  const list: Backend[] = mode === "studio" ? ["studio"] : mode === "vertex" ? ["vertex"] : ["vertex", "studio"];
  return list
    .filter((b) => !(b === "vertex" && (Date.now() < vertexBlockedUntil || !env.vertexKey())))
    .map((b) => ({ backend: b, ai: client(b) }));
}

/** Schlüssel passt nicht zu Vertex (oder Modell dort unbekannt) → Vertex vorerst überspringen. */
export function noteBackendError(backend: Backend, e: unknown) {
  if (backend !== "vertex") return;
  const t = errText(e);
  if (/\b(401|403)\b|UNAUTHENTICATED|PERMISSION_DENIED|API key not valid|API_KEY/i.test(t)) {
    vertexBlockedUntil = Date.now() + 10 * 60_000;
    console.warn("vertex: key rejected, using AI Studio for the next 10 minutes");
  }
}

/** Kurze, lesbare Fehlermeldung für die Logs (ohne Schlüssel). */
export function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/key=[^&\s"]+/gi, "key=***").slice(0, 400);
}

/** Führt eine Anfrage nacheinander über alle Wege aus, bis eine klappt. */
export async function viaBackends<T>(what: string, fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  let last: unknown = null;
  for (const { backend, ai } of backends()) {
    try {
      return await fn(ai);
    } catch (e) {
      last = e;
      noteBackendError(backend, e);
      console.warn(`${what}: ${backend} failed (${errText(e).slice(0, 200)})`);
    }
  }
  throw last ?? new Error(`${what}: no backend`);
}
