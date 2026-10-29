// Zentrale Stelle für alle Einstellungen aus den Umgebungsvariablen.
// Nur auf dem Server benutzen – hier liegen die Schlüssel.

const v = (name: string, fallback = ""): string => (process.env[name] ?? "").trim() || fallback;

export const env = {
  geminiKey: () => v("GEMINI_API_KEY"),

  chatModel: () => v("GEMINI_CHAT_MODEL", "gemini-3.8-flash"),
  /** Optional: minimal | low | medium | high */
  thinkingLevel: () => v("GEMINI_THINKING_LEVEL"),

  liveModel: () => v("LIVE_MODEL") || v("REALTIME_MODEL", "gemini-3.8-live"),
  liveVoice: () => v("LIVE_VOICE") || v("REALTIME_VOICE", "Aoede"),
  callMaxSeconds: () => {
    const n = parseInt(v("CALL_MAX_SECONDS", "300"), 10);
    return Number.isFinite(n) && n >= 30 ? Math.min(n, 1800) : 300;
  },
  transcribeModel: () => v("TRANSCRIBE_MODEL", "gemini-3.5-transcribe"),
  ttsModel: () => v("TTS_MODEL", "gemini-3.8-flash-lite-tts"),
  ttsVoice: () => v("TTS_VOICE", "Aoede"),

  // Supabase: Secret Key (empfohlen) oder Publishable Key (dann Insert-Policy nötig, siehe supabase/leads.sql)
  supabaseUrl: () => (v("SUPABASE_URL") || v("NEXT_PUBLIC_SUPABASE_URL")).replace(/\/+$/, ""),
  supabaseKey: () =>
    v("SUPABASE_SECRET_KEY") || v("SUPABASE_SERVICE_ROLE_KEY") || v("SUPABASE_PUBLISHABLE_KEY") || v("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  telegramToken: () => v("TELEGRAM_BOT_TOKEN"),
  telegramChat: () => v("TELEGRAM_CHAT_ID"),

  accessCode: () => v("DEMO_ACCESS_CODE"),
  demoBanner: () => v("DEMO_BANNER", "true").toLowerCase() !== "false",
  demoAuthor: () => v("DEMO_AUTHOR", "Azamat"),
};
