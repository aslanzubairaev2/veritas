// Zentrale Stelle für alle Einstellungen aus den Umgebungsvariablen.
// Nur auf dem Server benutzen – hier liegen die Schlüssel.

const v = (name: string, fallback = ""): string => (process.env[name] ?? "").trim() || fallback;

export const env = {
  geminiKey: () => v("GEMINI_API_KEY"),
  /** Schlüssel für Vertex AI (leer = derselbe wie GEMINI_API_KEY) */
  vertexKey: () => v("VERTEX_API_KEY") || v("GEMINI_API_KEY"),
  /** studio (Standard) | auto = erst Vertex AI, dann AI Studio | vertex */
  textBackend: () => v("GEMINI_TEXT_BACKEND", "studio").toLowerCase(),

  chatModel: () => v("GEMINI_CHAT_MODEL", "gemini-3.8-flash"),
  /** Hauptmodell + Ersatzmodelle (falls das Hauptmodell überlastet ist), ohne Dopplungen */
  chatModels: () =>
    [v("GEMINI_CHAT_MODEL", "gemini-3.8-flash"), ...v("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash-lite,gemini-3.6-flash").split(",")]
      .map((m) => m.trim())
      .filter((m, i, a) => m && a.indexOf(m) === i),
  /** Optional: minimal | low | medium | high */
  thinkingLevel: () => v("GEMINI_THINKING_LEVEL", "low"),

  liveModel: () => v("LIVE_MODEL") || v("REALTIME_MODEL", "gemini-3.8-live"),
  liveVoice: () => v("LIVE_VOICE") || v("REALTIME_VOICE", "Zephyr"),
  callMaxSeconds: () => {
    const n = parseInt(v("CALL_MAX_SECONDS", "300"), 10);
    return Number.isFinite(n) && n >= 30 ? Math.min(n, 1800) : 300;
  },
  transcribeModel: () => v("TRANSCRIBE_MODEL", "gemini-3.5-transcribe"),
  sttLiveModel: () => v("STT_LIVE_MODEL", "gemini-3.5-transcribe-live"),
  ttsModel: () => v("TTS_MODEL", "gemini-3.8-flash-lite-tts"),
  ttsVoice: () => v("TTS_VOICE", "Zephyr"),

  // Supabase: Secret Key (empfohlen) oder Publishable Key (dann Insert-Policy nötig, siehe supabase/leads.sql)
  supabaseUrl: () => (v("SUPABASE_URL") || v("NEXT_PUBLIC_SUPABASE_URL")).replace(/\/+$/, ""),
  supabaseKey: () =>
    v("SUPABASE_SECRET_KEY") || v("SUPABASE_SERVICE_ROLE_KEY") || v("SUPABASE_PUBLISHABLE_KEY") || v("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  telegramToken: () => v("TELEGRAM_BOT_TOKEN"),
  telegramChat: () => v("TELEGRAM_CHAT_ID"),

  accessCode: () => v("DEMO_ACCESS_CODE"),
  crmDbKey: () => v("CRM_DB_KEY"),
  crmPassword: () => v("CRM_PASSWORD"),
  /** Subdomain/Host, unter dem die CRM-Startseite erscheint (z. B. veritas-crm.vercel.app) */
  crmHost: () => v("CRM_HOST", "veritas-crm"),
  /** Werkzeuge im Sprachgespräch asynchron (Modell spricht weiter, während gespeichert wird) */
  // Standard: blockierend – das Modell wartet die ~0,3 s auf das CRM und spricht dann sicher weiter
  liveAsyncTools: () => v("LIVE_ASYNC_TOOLS", "false").toLowerCase() === "true",
  demoBanner: () => v("DEMO_BANNER", "true").toLowerCase() !== "false",
  demoAuthor: () => v("DEMO_AUTHOR", "Azamat"),
};
