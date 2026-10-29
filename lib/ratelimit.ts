// Einfacher Schutz vor Missbrauch (Kosten!). Pro Server-Instanz im Speicher –
// für eine Demo ausreichend. Für echten Betrieb: Upstash/Vercel KV o. Ä.

const buckets = new Map<string, number[]>();

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim();
}

/** true = erlaubt */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) {
    for (const [k, arr] of buckets) if (!arr.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return true;
}

export function tooMany() {
  return Response.json(
    { error: "Zu viele Anfragen. Bitte in ein paar Minuten erneut versuchen. / Слишком много запросов, попробуйте через несколько минут." },
    { status: 429 },
  );
}
