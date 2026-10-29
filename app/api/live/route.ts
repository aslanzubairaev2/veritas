import { Modality } from "@google/genai";
import { env } from "@/lib/env";
import { errText, gemini } from "@/lib/gemini";
import { callbackTool, voiceInstructions } from "@/lib/prompt";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Erstellt einen kurzlebigen Einmal-Schlüssel (Ephemeral Token) für ein Gemini-Live-Gespräch.
// Modell, Anweisungen, Stimme und Werkzeuge sind im Token festgeschrieben –
// der Browser kann sie nicht ändern, und der echte GEMINI_API_KEY bleibt auf dem Server.
export async function POST(req: Request) {
  if (!env.geminiKey()) {
    return Response.json({ error: "Sprachmodus ist nicht eingerichtet (GEMINI_API_KEY fehlt)." }, { status: 503 });
  }
  if (!rateLimit(`live:${clientIp(req)}`, 6, 60 * 60_000)) return tooMany();

  const { lang } = (await req.json().catch(() => ({}))) as { lang?: string };
  const language = lang === "ru" || lang === "en" ? lang : "de";
  const maxSeconds = env.callMaxSeconds();

  try {
    const params = {
      config: {
        uses: 2, // 2 Verbindungen: falls der Browser die API-Version wechseln muss
        newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
        expireTime: new Date(Date.now() + (maxSeconds + 60) * 1000).toISOString(),
        liveConnectConstraints: {
          model: env.liveModel(),
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: voiceInstructions(language),
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env.liveVoice() } } },
            tools: [{ functionDeclarations: [callbackTool] }],
            inputAudioTranscription: {
              languageCodes:
                language === "ru" ? ["ru-RU", "de-DE", "en-US"] : language === "en" ? ["en-US", "de-DE", "ru-RU"] : ["de-DE", "ru-RU", "en-US"],
            },
            outputAudioTranscription: {},
          },
        },
        // Kein lockAdditionalFields: dann sind alle Felder aus liveConnectConstraints festgeschrieben.
        // (Ein leeres Array erzeugt eine field_mask, die die API mit 400 ablehnt.)
      },
    };
    let token;
    try {
      token = await gemini().authTokens.create(params);
    } catch (e) {
      console.warn("auth token v1beta failed, retrying v1alpha:", errText(e));
      token = await gemini().authTokens.create({ config: { ...params.config, httpOptions: { apiVersion: "v1alpha" } } });
    }
    if (!token.name) throw new Error("no token name");
    return Response.json(
      { token: token.name, model: env.liveModel(), maxSeconds },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("live token error:", errText(e));
    return Response.json({ error: "Sprachdienst nicht erreichbar." }, { status: 502 });
  }
}
