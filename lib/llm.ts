import { env } from "./env";
import { gemini } from "./gemini";

export type ChatMsg = { role: "user" | "assistant"; content: string };

/** Liefert einen Text-Stream (nur der Antworttext, Stück für Stück). */
export async function streamChat(system: string, history: ChatMsg[], signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const level = env.thinkingLevel();
  const stream = await gemini().models.generateContentStream({
    model: env.chatModel(),
    contents: history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    config: {
      systemInstruction: system,
      abortSignal: signal,
      ...(level ? { thinkingConfig: { thinkingLevel: level as never } } : {}),
    },
  });

  const encoder = new TextEncoder();
  const it = stream[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) return controller.close();
        const piece = value?.text;
        if (piece) controller.enqueue(encoder.encode(piece));
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      await it.return?.(undefined);
    },
  });
}
