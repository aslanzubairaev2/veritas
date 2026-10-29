import { Modality } from "@google/genai";
import { env } from "@/lib/env";
import { errText, gemini } from "@/lib/gemini";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Rohes 16-bit-PCM (mono) in eine WAV-Datei verpacken. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Vorlesen: Text → Sprache (WAV)
export async function POST(req: Request) {
  if (!env.geminiKey()) return Response.json({ error: "Vorlesen nicht eingerichtet." }, { status: 503 });
  if (!rateLimit(`tts:${clientIp(req)}`, 40, 10 * 60_000)) return tooMany();

  const { text, lang } = (await req.json().catch(() => ({}))) as { text?: string; lang?: string };
  const input = String(text ?? "")
    .replace(/\[\[RUECKRUF\]\]/g, "")
    .replace(/^•\s*/gm, "")
    .trim()
    .slice(0, 1500);
  if (!input) return Response.json({ error: "Kein Text." }, { status: 400 });

  try {
    const res = await gemini().models.generateContent({
      model: env.ttsModel(),
      contents: [
        {
          role: "user",
          parts: [
            {
              text: input,
              // Gemini-3.8-TTS liest den Text wörtlich – die Sprechweise gehört in speechMetadata
              speechMetadata: {
                style:
                  lang === "ru"
                    ? "тепло, спокойно, чуть медленнее обычного, как внимательный консультант службы ухода"
                    : lang === "en"
                      ? "warm, calm, a little slower than usual, like an attentive home-care advisor"
                      : "warm, ruhig, etwas langsamer, wie eine aufmerksame Beraterin eines Pflegedienstes",
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env.ttsVoice() } } },
      },
    });

    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const b64 = part?.inlineData?.data;
    if (!b64) throw new Error("no audio in response");
    const mime = (part?.inlineData?.mimeType || "audio/wav").toLowerCase();
    let audio: Buffer = Buffer.from(b64, "base64");
    // Ältere TTS-Modelle liefern rohes PCM (audio/l16 bzw. audio/pcm) ohne WAV-Kopf
    if (!mime.includes("wav") && audio.subarray(0, 4).toString() !== "RIFF") {
      const rate = parseInt(/rate=(\d+)/.exec(mime)?.[1] ?? "24000", 10);
      audio = pcmToWav(audio, rate);
    }
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("tts failed:", errText(e));
    return Response.json({ error: "Vorlesen fehlgeschlagen." }, { status: 502 });
  }
}
