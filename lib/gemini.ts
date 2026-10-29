import { GoogleGenAI } from "@google/genai";
import { env } from "./env";

let client: GoogleGenAI | null = null;
let clientKey = "";

/** Server-Client für die Gemini API. Der Schlüssel verlässt nie den Server. */
export function gemini(): GoogleGenAI {
  const key = env.geminiKey();
  if (!key) throw new Error("NO_KEY");
  if (!client || clientKey !== key) {
    const baseUrl = (process.env.GEMINI_BASE_URL ?? "").trim(); // nur für Tests
    client = new GoogleGenAI({ apiKey: key, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
    clientKey = key;
  }
  return client;
}

/** Kurze, lesbare Fehlermeldung für die Logs (ohne Schlüssel). */
export function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/key=[^&\s"]+/gi, "key=***").slice(0, 400);
}
