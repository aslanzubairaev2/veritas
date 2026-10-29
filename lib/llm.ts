import { env } from "./env";
import { errText, gemini } from "./gemini";

export type ChatMsg = { role: "user" | "assistant"; content: string };

/** Wie lange ein Modell Zeit hat, mit der Antwort zu beginnen, bevor das nächste versucht wird. */
const FIRST_CHUNK_TIMEOUT_MS = 15_000;

type Opened = { model: string; it: AsyncIterator<{ text?: string }>; firstText: string; ctl: AbortController };

async function openModel(model: string, primary: boolean, system: string, history: ChatMsg[]): Promise<Opened> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FIRST_CHUNK_TIMEOUT_MS);
  const level = env.thinkingLevel();
  try {
    const stream = await gemini().models.generateContentStream({
      model,
      contents: history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      config: {
        systemInstruction: system,
        abortSignal: ctl.signal,
        // Thinking-Stufe nur beim Hauptmodell – Ersatzmodelle unterstützen sie evtl. nicht
        ...(primary && level ? { thinkingConfig: { thinkingLevel: level as never } } : {}),
      },
    });
    const it = stream[Symbol.asyncIterator]();
    // Auf das erste Stück mit Text warten – erst dann gilt das Modell als „antwortet“
    let firstText = "";
    while (!firstText) {
      const { done, value } = await it.next();
      if (done) break;
      firstText = value?.text ?? "";
    }
    clearTimeout(timer);
    return { model, it, firstText, ctl };
  } catch (e) {
    clearTimeout(timer);
    ctl.abort();
    throw e;
  }
}

/** Liefert einen Text-Stream. Bei Überlastung/Zeitüberschreitung wird automatisch das nächste Modell versucht. */
export async function streamChat(system: string, history: ChatMsg[]): Promise<ReadableStream<Uint8Array>> {
  const t0 = Date.now();
  const models = env.chatModels();
  let opened: Opened | null = null;
  let lastErr: unknown = null;

  for (let i = 0; i < models.length && !opened; i++) {
    try {
      opened = await openModel(models[i], i === 0, system, history);
      console.log(`chat: ${models[i]} answered after ${Date.now() - t0} ms`);
    } catch (e) {
      lastErr = e;
      const why = (e as Error)?.name === "AbortError" ? "timeout" : errText(e).slice(0, 200);
      console.warn(`chat: ${models[i]} failed after ${Date.now() - t0} ms (${why})`);
    }
  }
  if (!opened) throw lastErr ?? new Error("no model answered");

  const { it, firstText, model } = opened;
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
          console.log(`chat: ${model} done after ${Date.now() - t0} ms`);
          return controller.close();
        }
        if (value?.text) controller.enqueue(encoder.encode(value.text));
      } catch (e) {
        console.error(`chat: ${model} stream error:`, errText(e).slice(0, 300));
        controller.error(e);
      }
    },
    async cancel() {
      await it.return?.(undefined);
    },
  });
}
