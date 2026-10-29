import { env } from "./env";
import { gemini } from "./gemini";

export type ChatMsg = { role: "user" | "assistant"; content: string };

/** Liefert einen Text-Stream (nur der Antworttext, Stück für Stück). */
export async function streamChat(system: string, history: ChatMsg[]): Promise<ReadableStream<Uint8Array>> {
  const level = env.thinkingLevel();
  const t0 = Date.now();
  console.log(`chat: request to ${env.chatModel()} (thinking ${level || "default"})`);
  const stream = await gemini().models.generateContentStream({
    model: env.chatModel(),
    contents: history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    config: {
      systemInstruction: system,
      ...(level ? { thinkingConfig: { thinkingLevel: level as never } } : {}),
    },
  });

  console.log(`chat: stream opened after ${Date.now() - t0} ms`);
  const encoder = new TextEncoder();
  const it = stream[Symbol.asyncIterator]();
  let first = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) {
          console.log(`chat: done after ${Date.now() - t0} ms`);
          return controller.close();
        }
        if (first) {
          first = false;
          console.log(`chat: first chunk after ${Date.now() - t0} ms`);
        }
        const piece = value?.text;
        if (piece) controller.enqueue(encoder.encode(piece));
      } catch (e) {
        console.error(`chat: stream error after ${Date.now() - t0} ms:`, e instanceof Error ? e.message.slice(0, 300) : e);
        controller.error(e);
      }
    },
    async cancel() {
      await it.return?.(undefined);
    },
  });
}
