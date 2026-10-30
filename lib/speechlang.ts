import type { Lang } from "./i18n";

// Sprache, in der die Person tatsächlich spricht/schreibt – für die Spracherkennung.
// Mehrere zugelassene Sprachen lassen kurze Sätze ins Deutsche/Lateinische kippen
// („Да, согласен“ → „Da, saglasna“). Deshalb erkennen wir genau EINE Sprache.
export function spokenLang(texts: string[], fallback: Lang): Lang {
  const sample = texts.filter(Boolean).slice(-6).join(" ");
  const cyr = (sample.match(/[а-яё]/gi) ?? []).length;
  const lat = (sample.match(/[a-zäöüß]/gi) ?? []).length;
  if (cyr + lat < 6) return fallback;
  if (cyr >= lat * 0.5) return "ru";
  const de = (sample.match(/\b(und|ich|ist|die|der|das|nicht|mein|meine|wie|wir|sie|mutter|vater|pflege\w*)\b|[äöüß]/gi) ?? []).length;
  const en = (sample.match(/\b(the|and|is|my|you|what|how|mother|father|care|need|please)\b/gi) ?? []).length;
  if (de > en) return "de";
  if (en > de) return "en";
  return fallback === "ru" ? "de" : fallback;
}

export const BCP: Record<Lang, string> = { ru: "ru-RU", de: "de-DE", en: "en-US" };
