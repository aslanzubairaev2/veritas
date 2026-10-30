"use client";

import { useMemo, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { RESOURCES, resourceFile, resourceUrl } from "@/lib/resources";
import { mapEmbed, mapRoute, officeId, type Office } from "@/lib/offices";

// Interaktive Bausteine, die der Assistent über Marker in seine Antwort setzen kann:
//   [[DOC:id]]          Karte eines offiziellen Formulars/Ratgebers (Link, Telefon, PDF-Download)
//   [[CHOICES:a|b|c]]   Antwort-Knöpfe
//   [[TIME]]            Auswahl eines Rückruf-Zeitfensters
//   [[RUECKRUF]]        Kontaktformular (siehe LeadForm)
// Nur diese Marker werden ausgewertet; alles andere bleibt Text.

export type Block =
  | { kind: "text"; text: string }
  | { kind: "doc"; id: string }
  | { kind: "choices"; options: string[] }
  | { kind: "time" }
  | { kind: "map"; id: string }
  | { kind: "lead" };

const MARKER_RE = /\[\[(DOC:([a-z_]+)|CHOICES:([^\]]{1,300})|MAP:([a-z]+)|TIME|RUECKRUF)\]\]/g;

export function parseBlocks(content: string): Block[] {
  const out: Block[] = [];
  let last = 0;
  for (const m of content.matchAll(MARKER_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ kind: "text", text: content.slice(last, i) });
    if (m[2]) {
      if (RESOURCES.some((r) => r.id === m[2])) out.push({ kind: "doc", id: m[2] });
    } else if (m[3]) {
      const options = m[3].split("|").map((x) => x.trim()).filter(Boolean).slice(0, 4).map((x) => x.slice(0, 40));
      if (options.length) out.push({ kind: "choices", options });
    } else if (m[4]) out.push({ kind: "map", id: m[4] });
    else if (m[1] === "TIME") out.push({ kind: "time" });
    else if (m[1] === "RUECKRUF") out.push({ kind: "lead" });
    last = i + m[0].length;
  }
  if (last < content.length) out.push({ kind: "text", text: content.slice(last) });
  // Text aufräumen; ein angefangener Marker am Ende (beim Streamen) wird versteckt
  return out
    .map((b) => (b.kind === "text" ? { ...b, text: b.text.replace(/\[\[[A-Z]*(:[^\]]*)?\]?$/, "").replace(/\n{3,}/g, "\n\n").trim() } : b))
    .filter((b) => b.kind !== "text" || b.text);
}

/** Text ohne Marker (zum Vorlesen, für den Verlauf im Anruf) */
export function plainText(content: string) {
  return content.replace(/\[\[[^\]]*\]\]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

const L = {
  de: { open: "Öffnen", pdf: "PDF herunterladen", pickTime: "Wann passt ein Rückruf?", send: "Auswählen", chosen: "Gewählt" },
  ru: { open: "Открыть", pdf: "Скачать PDF", pickTime: "Когда удобно, чтобы мы перезвонили?", send: "Выбрать", chosen: "Выбрано" },
  en: { open: "Open", pdf: "Download PDF", pickTime: "When suits you for a callback?", send: "Choose", chosen: "Chosen" },
};

export function DocCard({ id, lang }: { id: string; lang: Lang }) {
  const r = RESOURCES.find((x) => x.id === id);
  if (!r) return null;
  const file = resourceFile(r, lang);
  const url = resourceUrl(r, lang);
  return (
    <div className="doc-card">
      <span className="doc-icon" aria-hidden="true">{file ? "📄" : "🔗"}</span>
      <div className="doc-body">
        <strong>{r.title[lang]}</strong>
        {r.phone && (
          <a className="doc-phone" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>
            {r.phone}
            {r.hours ? <small> · {r.hours.replace(/\s*\(.*\)/, "")}</small> : null}
          </a>
        )}
        <div className="doc-actions">
          {file && (
            <a className="doc-btn primary" href={file} target="_blank" rel="noopener noreferrer" download>
              {L[lang].pdf}
            </a>
          )}
          {(!file || url !== file) && (
            <a className="doc-btn" href={url} target="_blank" rel="noopener noreferrer">
              {L[lang].open}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const ML = { de: "Route", ru: "Маршрут", en: "Directions" };

export function MapCard({ id, lang, locations, company }: { id: string; lang: Lang; locations: Office[]; company: string }) {
  const o = locations.find((x) => officeId(x) === id);
  if (!o) return null;
  return (
    <div className="map-card">
      <iframe title={o.label} src={mapEmbed(o)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      <div className="map-info">
        <strong>{company} {o.label}</strong>
        <span>{o.address}</span>
        <div className="doc-actions">
          <a className="doc-btn primary" href={mapRoute(o)} target="_blank" rel="noopener noreferrer">{ML[lang]}</a>
          <a className="doc-btn" href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}>{o.phone}</a>
        </div>
      </div>
    </div>
  );
}

export function Choices({ options, onPick, disabled }: { options: string[]; onPick: (v: string) => void; disabled?: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="choices" role="group">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`choice${picked === o ? " is-picked" : ""}`}
          disabled={disabled || picked !== null}
          onClick={() => {
            setPicked(o);
            onPick(o);
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

const WD: Record<Lang, string[]> = {
  de: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
  ru: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
const SLOTS = ["8–10", "10–12", "12–14", "14–16"];

/** Nächste Werktage (Mo–Fr), heute nur bis 14 Uhr */
function workdays(n: number): Date[] {
  const out: Date[] = [];
  const d = new Date();
  if (d.getHours() >= 14) d.setDate(d.getDate() + 1);
  while (out.length < n) {
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function timeLabel(day: Date, slot: string, lang: Lang) {
  const date = `${String(day.getDate()).padStart(2, "0")}.${String(day.getMonth() + 1).padStart(2, "0")}`;
  const unit = lang === "de" ? " Uhr" : lang === "ru" ? " ч" : "";
  return `${WD[lang][day.getDay()]} ${date}, ${slot}${unit}`;
}

/** Auswahl eines Zeitfensters (Werktage, Bürozeiten). onPick bekommt den lesbaren Text. */
export function TimePicker({ lang, onPick, compact }: { lang: Lang; onPick: (label: string) => void; compact?: boolean }) {
  const days = useMemo(() => workdays(5), []);
  const [day, setDay] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const today = new Date().toDateString();
  const slots = SLOTS.filter((s) => days[day].toDateString() !== today || parseInt(s, 10) >= new Date().getHours() + 1);
  if (done) return <p className="picked-note">✓ {L[lang].chosen}: {done}</p>;
  return (
    <div className={`timepick${compact ? " compact" : ""}`}>
      {!compact && <p className="timepick-q">{L[lang].pickTime}</p>}
      <div className="timepick-days" role="group">
        {days.map((d, i) => (
          <button key={d.toISOString()} type="button" aria-pressed={i === day} onClick={() => setDay(i)}>
            <span>{WD[lang][d.getDay()]}</span>
            <b>{d.getDate()}.{d.getMonth() + 1}.</b>
          </button>
        ))}
      </div>
      <div className="timepick-slots" role="group">
        {slots.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              const label = timeLabel(days[day], s, lang);
              setDone(label);
              onPick(label);
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
