import type { GoogleGenAI } from "@google/genai";
import { env } from "./env";
import { backends, errText, noteBackendError } from "./gemini";

export type ChatMsg = { role: "user" | "assistant"; content: string };

/** Wie lange ein Versuch Zeit hat, mit der Antwort zu beginnen. */
const PRIMARY_TIMEOUT_MS = 9_000;
const FALLBACK_TIMEOUT_MS = 15_000;
/** Gesamtbudget (Vercel bricht nach 60 s ab) */
const TOTAL_BUDGET_MS = 52_000;

type Opened = { label: string; it: AsyncIterator<{ text?: string }>; firstText: string };

async function openModel(
  ai: GoogleGenAI,
  model: string,
  withThinking: boolean,
  timeoutMs: number,
  system: string,
  history: ChatMsg[],
): Promise<Omit<Opened, "label">> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const level = env.thinkingLevel();
  try {
    const stream = await ai.models.generateContentStream({
      model,
      contents: history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      config: {
        systemInstruction: system,
        abortSignal: ctl.signal,
        // Kurzes Nachdenken = schnelle Antwort
        ...(withThinking && level ? { thinkingConfig: { thinkingLevel: level as never } } : {}),
      },
    });
    const it = stream[Symbol.asyncIterator]();
    let firstText = "";
    while (!firstText) {
      const { done, value } = await it.next();
      if (done) break;
      firstText = value?.text ?? "";
    }
    clearTimeout(timer);
    return { it, firstText };
  } catch (e) {
    clearTimeout(timer);
    ctl.abort();
    throw e;
  }
}

/**
 * Liefert einen Text-Stream. Reihenfolge: Hauptmodell über Vertex AI, dann über AI Studio,
 * dann Ersatzmodelle – bis eines innerhalb der Zeit zu antworten beginnt.
 */
export async function streamChat(system: string, history: ChatMsg[]): Promise<ReadableStream<Uint8Array>> {
  const t0 = Date.now();
  const models = env.chatModels();
  let opened: Opened | null = null;
  let lastErr: unknown = null;

  outer: for (let i = 0; i < models.length; i++) {
    for (const { backend, ai } of backends()) {
      const left = TOTAL_BUDGET_MS - (Date.now() - t0);
      if (left < 3_000) break outer;
      const timeout = Math.min(i === 0 ? PRIMARY_TIMEOUT_MS : FALLBACK_TIMEOUT_MS, left);
      const label = `${backend}/${models[i]}`;
      let withThinking = true;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const o = await openModel(ai, models[i], withThinking, timeout, system, history);
          opened = { label, ...o };
          console.log(`chat: ${label} answered after ${Date.now() - t0} ms`);
          break outer;
        } catch (e) {
          lastErr = e;
          noteBackendError(backend, e);
          const text = errText(e);
          const why = (e as Error)?.name === "AbortError" || /abort/i.test(text) ? "timeout" : text.slice(0, 200);
          console.warn(`chat: ${label} failed after ${Date.now() - t0} ms (${why})`);
          if (withThinking && /thinking/i.test(text) && /400|INVALID_ARGUMENT/i.test(text)) {
            withThinking = false;
            continue;
          }
          break;
        }
      }
    }
  }
  if (!opened) throw lastErr ?? new Error("no model answered");

  const { it, firstText, label } = opened;
  const encoder = new TextEncoder();
  let sentFirst = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentFirst) {
        sentFirst = true;
        if (firstText) return controller.enqueue(encoder.encode(firstText));
      }
      try {
        const { done, value } = await it.next();
        if (done) {
          console.log(`chat: ${label} done after ${Date.now() - t0} ms`);
          return controller.close();
        }
        if (value?.text) controller.enqueue(encoder.encode(value.text));
      } catch (e) {
        console.error(`chat: ${label} stream error:`, errText(e).slice(0, 300));
        controller.error(e);
      }
    },
    async cancel() {
      await it.return?.(undefined);
    },
  });
}
