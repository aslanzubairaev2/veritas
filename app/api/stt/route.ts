import { Modality } from "@google/genai";
import { env } from "@/lib/env";
import { errText, gemini } from "@/lib/gemini";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";
import { VOCAB } from "@/lib/vocab";

export const runtime = "nodejs";

// Einmal-Schlüssel für die Mikrofon-Taste: Echtzeit-Spracherkennung mit gemini-3.5-transcribe-live.
// Die Sprache erkennt das Modell selbst (nur Russisch, Deutsch, Englisch zugelassen),
// das Fachwörterbuch sorgt für richtige Schreibweise (Schöneberg, Pflegegrad …).
export async function POST(req: Request) {
  if (!env.geminiKey()) return Response.json({ error: "Spracherkennung nicht eingerichtet." }, { status: 503 });
  if (!rateLimit(`stt:${clientIp(req)}`, 60, 10 * 60_000)) return tooMany();

  const params = {
    config: {
      uses: 2,
      newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
      expireTime: new Date(Date.now() + 3 * 60_000).toISOString(),
      liveConnectConstraints: {
        model: env.sttLiveModel(),
        config: {
          responseModalities: [Modality.TEXT],
          inputAudioTranscription: {
            languageCodes: ["ru-RU", "de-DE", "en-US"],
            customVocabulary: VOCAB,
            mode: "SMART" as never,
          },
        },
      },
    },
  };
  try {
    let token;
    try {
      token = await gemini().authTokens.create(params);
    } catch (e) {
      console.warn("stt token v1beta failed, retrying v1alpha:", errText(e));
      token = await gemini().authTokens.create({ config: { ...params.config, httpOptions: { apiVersion: "v1alpha" } } });
    }
    if (!token.name) throw new Error("no token name");
    return Response.json({ token: token.name, model: env.sttLiveModel() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("stt token error:", errText(e));
    return Response.json({ error: "Spracherkennung nicht erreichbar." }, { status: 502 });
  }
}
