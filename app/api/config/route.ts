import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sagt der Oberfläche, welche Funktionen eingerichtet sind (ohne Schlüssel preiszugeben).
export async function GET() {
  const ai = !!env.geminiKey();
  return Response.json(
    {
      chat: ai,
      voiceCall: ai,
      serverSpeech: ai,
      leadsStored: !!(env.supabaseUrl() && env.supabaseKey()) || !!(env.telegramToken() && env.telegramChat()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
