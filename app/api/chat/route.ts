import { env } from "@/lib/env";
import { errText } from "@/lib/gemini";
import { chatInstructions } from "@/lib/prompt";
import { convFrom, memoryBlock } from "@/lib/memory";
import { streamChat, type ChatMsg } from "@/lib/llm";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!env.geminiKey()) {
    return Response.json({ error: "Kein KI-Schlüssel eingerichtet (GEMINI_API_KEY)." }, { status: 503 });
  }
  if (!rateLimit(`chat:${clientIp(req)}`, 40, 10 * 60_000)) return tooMany();

  let body: { messages?: unknown; conversationId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const history: ChatMsg[] = incoming
    .filter(
      (m): m is ChatMsg =>
        !!m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    )
    .slice(-14)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  // Gemini erwartet, dass das Gespräch mit einer Nutzer-Nachricht beginnt
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history[history.length - 1].role !== "user") {
    return Response.json({ error: "Keine Frage erhalten" }, { status: 400 });
  }

  try {
    const memory = await memoryBlock(convFrom(body.conversationId), [], "chat");
    const stream = await streamChat(chatInstructions(memory.text), history);
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  } catch (e) {
    console.error("chat error:", errText(e));
    return Response.json({ error: "Der KI-Dienst antwortet gerade nicht. Bitte gleich noch einmal versuchen." }, { status: 502 });
  }
}
