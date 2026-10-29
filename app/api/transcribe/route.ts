import { env } from "@/lib/env";
import { errText, gemini } from "@/lib/gemini";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const VOCAB = [
  "Pflegedienst", "Pflegegrad", "Pflegekasse", "Verhinderungspflege", "Kurzzeitpflege", "Entlastungsbetrag",
  "Behandlungspflege", "Grundpflege", "Demenz", "Hausnotruf", "Medizinischer Dienst", "VERITAS",
  "Marzahn", "Charlottenburg", "Hellersdorf", "Friedenau", "Steglitz", "Zossen", "GOODLIFE", "Sonnenhaus", "Schöne Linde",
];

function textOf(res: { text?: string; candidates?: { content?: { parts?: { text?: string }[] } }[] }) {
  const direct = res.text?.trim();
  if (direct) return direct;
  return (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}

// Mikrofon-Taste: Audio → Text
export async function POST(req: Request) {
  if (!env.geminiKey()) return Response.json({ error: "Spracherkennung nicht eingerichtet." }, { status: 503 });
  if (!rateLimit(`stt:${clientIp(req)}`, 40, 10 * 60_000)) return tooMany();

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size < 800) {
    return Response.json({ error: "Keine Aufnahme erhalten." }, { status: 400 });
  }
  if (audio.size > 8 * 1024 * 1024) return Response.json({ error: "Aufnahme zu lang." }, { status: 413 });

  const l = form?.get("lang");
  const lang = l === "ru" || l === "en" ? l : "de";
  const mimeType = (audio.type || "audio/webm").split(";")[0];
  const data = Buffer.from(await audio.arrayBuffer()).toString("base64");
  const audioPart = { inlineData: { mimeType, data } };

  // 1) Spezialmodell für Spracherkennung
  try {
    const res = await gemini().models.generateContent({
      model: env.transcribeModel(),
      contents: [{ role: "user", parts: [audioPart] }],
      config: {
        audioTranscriptionConfig: {
          languageCodes: lang === "ru" ? ["ru-RU", "de-DE", "en-US"] : lang === "en" ? ["en-US", "de-DE", "ru-RU"] : ["de-DE", "ru-RU", "en-US"],
          customVocabulary: VOCAB,
        },
      },
    });
    const text = textOf(res);
    if (text) return Response.json({ text });
    console.warn("transcribe model returned empty text, using fallback");
  } catch (e) {
    console.warn("transcribe model failed, using fallback:", errText(e));
  }

  // 2) Rückfall: normale Gemini-Modelle mit Anweisung (falls das Spezialmodell leer bleibt oder überlastet ist)
  for (const model of env.chatModels()) {
    try {
      const res = await gemini().models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              audioPart,
              {
                text:
                  "Schreibe wörtlich auf, was in dieser Aufnahme gesagt wird, in der gesprochenen Sprache (Russisch, Deutsch oder Englisch). " +
                  `Fachbegriffe richtig schreiben: ${VOCAB.join(", ")}. Gib NUR den Text zurück, ohne Kommentar. Wenn nichts gesagt wird, gib nichts zurück.`,
              },
            ],
          },
        ],
        config: { temperature: 0 },
      });
      return Response.json({ text: textOf(res) });
    } catch (e) {
      console.warn(`transcribe fallback ${model} failed:`, errText(e).slice(0, 200));
    }
  }
  return Response.json({ error: "Spracherkennung fehlgeschlagen." }, { status: 502 });
}
