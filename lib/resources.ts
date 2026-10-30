import type { Lang } from "./tenant";

// Offizielle, unabhängige Stellen, Formulare und Ratgeber (nicht von VERITAS).
// Einzige Quelle: daraus entstehen der Abschnitt in den Anweisungen, die Link-Karten im Anruf
// und die Liste der Adressen, die im Chat als Link klickbar werden.
// Geprüft: Oktober 2026.

export type Resource = {
  id: string;
  title: Record<Lang, string>;
  /** Wofür – für die Anweisungen (Deutsch) */
  use: string;
  url: string;
  /** Sprachversionen, falls vorhanden */
  urls?: Partial<Record<Lang, string>>;
  phone?: string;
  hours?: string;
  /** Direkt herunterladbares PDF (Formular, Vorlage, Merkblatt), ggf. je Sprache */
  file?: string;
  files?: Partial<Record<Lang, string>>;
};

export const RESOURCES: Resource[] = [
  {
    id: "pflegestuetzpunkte",
    title: { de: "Pflegestützpunkte Berlin – kostenlose Beratung", ru: "Pflegestützpunkte Berlin – бесплатные консультации", en: "Berlin care support centres – free advice" },
    use: "Kostenlose, unabhängige Pflegeberatung in Berlin, 36 Stützpunkte (3 pro Bezirk), auch per Telefon, Video oder Hausbesuch, mehrsprachig nach Termin. Hilft auch beim Antrag.",
    url: "https://www.pflegestuetzpunkteberlin.de",
    phone: "0800 59 500 59",
    hours: "kostenlos, Mo–Fr 9–18 Uhr",
  },
  {
    id: "antrag_info",
    title: { de: "Pflegeleistungen beantragen (gesund.bund.de)", ru: "Как подать заявление на уход (gesund.bund.de, по-русски)", en: "Applying for care benefits (gesund.bund.de)" },
    use: "Offizielles Gesundheitsportal des Bundes: Antrag formlos bei der Pflegekasse (Anruf, Brief, E-Mail; besser schriftlich wegen des Nachweises), was danach passiert, 25 Arbeitstage. Auch auf Russisch und Englisch.",
    url: "https://gesund.bund.de/pflegeleistungen-beantragen",
    urls: { ru: "https://gesund.bund.de/ru/pflegeleistungen-beantragen", en: "https://gesund.bund.de/en/pflegeleistungen-beantragen" },
  },
  {
    id: "antrag_muster",
    title: { de: "Muster-Antrag Pflegeversicherung (betanet)", ru: "Образец заявления в Pflegekasse (betanet)", en: "Sample application form (betanet)" },
    use: "Muster-Antrag auf Leistungen der Pflegeversicherung zum Ausdrucken oder Ausfüllen, dazu Fristen und Ablauf. Jede Pflegekasse hat aber ein eigenes Formular, das sie nach dem ersten Anruf zuschickt.",
    url: "https://www.betanet.de/pflegeantrag-und-pflegebegutachtung.html",
    file: "https://www.betanet.de/files/pdf/muster-antrag-pflege-ausfuellbar.pdf",
  },
  {
    id: "antrag_ausfuellen",
    title: { de: "So füllen Sie den Pflegeantrag aus (Verbraucherzentrale)", ru: "Как заполнить заявление (Verbraucherzentrale)", en: "How to fill in the application (consumer centre)" },
    use: "Verbraucherzentrale: Schritt für Schritt durch das Antragsformular der Pflegekasse.",
    url: "https://www.verbraucherzentrale.de/wissen/gesundheit-pflege/pflegeantrag-und-leistungen/so-fuellen-sie-den-antrag-auf-leistungen-der-pflegeversicherung-aus-42638",
  },
  {
    id: "md_begutachtung",
    title: { de: "Informationen zur Pflegebegutachtung (Medizinischer Dienst)", ru: "Памятка о визите Medizinischer Dienst (MD)", en: "Information on the care assessment (Medical Service)" },
    use: "Offizielles Merkblatt des Medizinischen Dienstes (PDF): Ablauf der Begutachtung und Checkliste zur Vorbereitung. Russische und englische Fassung siehe RU/EN-Link.",
    url: "https://medizinischerdienst.de/fileadmin/MD-zentraler-Ordner/Downloads/01_Pflegebegutachtung/250203_DEU_01_BF.pdf",
    file: "https://medizinischerdienst.de/fileadmin/MD-zentraler-Ordner/Downloads/01_Pflegebegutachtung/250203_DEU_01_BF.pdf",
    files: {
      ru: "https://medizinischerdienst.de/fileadmin/MD-zentraler-Ordner/Downloads/01_Pflegebegutachtung/250203_RUS_01_BF.pdf",
      en: "https://medizinischerdienst.de/fileadmin/MD-zentraler-Ordner/Downloads/01_Pflegebegutachtung/250203_ENG_01_BF.pdf",
    },
    urls: {
      ru: "https://medizinischerdienst.de/fileadmin/MD-zentraler-Ordner/Downloads/01_Pflegebegutachtung/250203_RUS_01_BF.pdf",
      en: "https://medizinischerdienst.de/fileadmin/MD-zentraler-Ordner/Downloads/01_Pflegebegutachtung/250203_ENG_01_BF.pdf",
    },
  },
  {
    id: "begutachtung_info",
    title: { de: "Pflegebegutachtung: worauf achten? (gesund.bund.de)", ru: "Экспертиза потребности в уходе: на что обратить внимание (gesund.bund.de, по-русски)", en: "Care assessment: what to watch out for (gesund.bund.de)" },
    use: "Offizielles Gesundheitsportal: wie die Begutachtung abläuft und wie man sich vorbereitet. Auf Russisch verfügbar.",
    url: "https://gesund.bund.de/pflegebegutachtung",
    urls: { ru: "https://gesund.bund.de/ru/pflegebegutachtung" },
  },
  {
    id: "pflegetagebuch",
    title: { de: "Pflegetagebuch – Vorlage zum Ausdrucken (betanet)", ru: "Дневник ухода – бланк для печати (betanet)", en: "Care diary – printable template (betanet)" },
    use: "Kostenlose PDF-Vorlage für das Pflegetagebuch zur Vorbereitung auf die Begutachtung oder für einen Widerspruch.",
    url: "https://www.betanet.de/pflegetagebuch.html",
    file: "https://www.betanet.de/files/pdf/pflege-tagebuch.pdf",
  },
  {
    id: "widerspruch",
    title: { de: "Pflegegrad abgelehnt? Widerspruch mit Musterbrief (Verbraucherzentrale)", ru: "Отказ в Pflegegrad: возражение с образцом письма (Verbraucherzentrale)", en: "Care grade refused? Objection with sample letter" },
    use: "Widerspruch innerhalb eines Monats nach dem Bescheid; kostenloser Musterbrief der Verbraucherzentrale.",
    url: "https://www.verbraucherzentrale.de/wissen/gesundheit-pflege/pflegeantrag-und-leistungen/pflegegrad-abgelehnt-so-wehren-sie-sich-mit-widerspruch-und-klage-11547",
  },
  {
    id: "alltagshilfe",
    title: { de: "Anerkannte Alltagshilfen in Berlin (Entlastungsbetrag)", ru: "Помощь в быту в Берлине за счёт Entlastungsbetrag", en: "Recognised everyday-help services in Berlin" },
    use: "Übersicht aller in Berlin anerkannten Angebote zur Unterstützung im Alltag (Haushalt, Betreuung, Begleitung), die über den Entlastungsbetrag bezahlt werden können – Suche nach Bezirk.",
    url: "https://www.pflegeunterstuetzung-berlin.de/unterstuetzung/uebersicht-aller-angebote",
  },
  {
    id: "pflege_kompakt",
    title: { de: "Pflege kompakt Berlin (Senatsverwaltung)", ru: "«Pflege kompakt Berlin» – ответы на частые вопросы", en: "Pflege kompakt Berlin – FAQ on home care" },
    use: "Land Berlin: Fragen und Antworten zur häuslichen Pflege, auch in einfacher Sprache.",
    url: "https://www.berlin.de/sen/pflege/pflege-und-rehabilitation/pflege-zu-hause/pflege-kompakt-berlin-1415067.php",
  },
  {
    id: "buergertelefon",
    title: { de: "Bürgertelefon zur Pflegeversicherung (Bundesgesundheitsministerium)", ru: "Горячая линия Минздрава по Pflegeversicherung", en: "Federal Health Ministry hotline on care insurance" },
    use: "Fragen zu Rechten und Leistungen der Pflegeversicherung.",
    url: "https://www.bundesgesundheitsministerium.de/service/buergertelefon.html",
    phone: "030 340 60 66-02",
    hours: "Mo–Mi 8–16, Do 8–18, Fr 8–12 Uhr",
  },
  {
    id: "pflegetelefon",
    title: { de: "Pflegetelefon für Angehörige (Bundesfamilienministerium)", ru: "Pflegetelefon для родственников (Минсемьи)", en: "Care hotline for relatives (Family Ministry)" },
    use: "Für pflegende Angehörige: Organisation der Pflege, Kosten, Familienpflegezeit, und Beratung in belastenden Situationen. Portal „Wege zur Pflege“.",
    url: "https://www.wege-zur-pflege.de",
    phone: "030 20 17 91 31",
    hours: "Mo–Do (Zeiten bitte auf der Website prüfen)",
  },
  {
    id: "pflege_in_not",
    title: { de: "Pflege in Not – bei Konflikten und Gewalt in der Pflege", ru: "Pflege in Not – при конфликтах и насилии в уходе", en: "Pflege in Not – conflict and violence in care" },
    use: "Berliner Beratung bei Überforderung, Konflikten oder Gewalt in der Pflege, für Gepflegte, Angehörige und Pflegekräfte, auch mehrsprachig. Bei akuter Gefahr: 110 bzw. 112.",
    url: "https://www.pflege-in-not.de",
  },
];

export const RESOURCE_IDS = RESOURCES.map((r) => r.id);

/** Adresse in der passenden Sprache */
export function resourceUrl(r: Resource, lang: Lang) {
  return r.urls?.[lang] ?? r.url;
}

/** PDF zum Herunterladen in der passenden Sprache (falls vorhanden) */
export function resourceFile(r: Resource, lang: Lang) {
  return r.files?.[lang] ?? r.file;
}

/** Hosts, deren Links im Chat klickbar werden (alles andere bleibt Text). */
export const LINK_HOSTS = Array.from(
  new Set(
    RESOURCES.flatMap((r) => [r.url, ...Object.values(r.urls ?? {})]).map((u) => new URL(u).hostname.replace(/^www\./, "")),
  ),
);

/** Abschnitt für die Anweisungen */
export function resourcesBlock(mode: "chat" | "voice", company: string): string {
  const lines = RESOURCES.map((r) => {
    const urls = [r.url, ...Object.entries(r.urls ?? {}).map(([l, u]) => `${l.toUpperCase()}: ${u}`)];
    return `- [${r.id}]${r.file ? " (PDF zum Herunterladen)" : ""} ${r.title.de}${r.phone ? ` – Tel. ${r.phone}${r.hours ? ` (${r.hours})` : ""}` : ""}. ${r.use}${mode === "chat" ? ` Link: ${urls.join(" | ")}` : ""}`;
  });
  const how =
    mode === "chat"
      ? "- Passt eine Stelle zur Frage, füge an der passenden Stelle eine eigene Zeile [[DOC:id]] ein (id aus der Liste). Die App zeigt daraus eine Karte mit Titel, Telefonnummer, Link und – falls vorhanden – Knopf „PDF herunterladen“, automatisch in der Sprache der Person. Schreib die Adresse dann NICHT zusätzlich aus. Höchstens zwei Karten pro Antwort. Erfinde NIE ids, Links oder Nummern."
      : "- Passt eine Stelle zur Frage, nenne sie kurz und sag die Telefonnummer, falls vorhanden. Links liest du nicht vor: rufe show_link mit der id auf – die Person sieht den Link dann auf dem Bildschirm und später im Chatverlauf. Sag dazu kurz „Ссылку я показала на экране“ / „Den Link sehen Sie jetzt auf dem Bildschirm“. Erfinde NIE Links oder Nummern.";
  return `OFFIZIELLE STELLEN, FORMULARE UND RATGEBER (unabhängig von ${company})
- Ordne Links genau zu: Jeder Link gehört nur zu dem Eintrag, unter dem er steht. Behaupte nie, ein Link sei z. B. „auf Russisch“, wenn kein RU-Link dabeisteht.
- Diese Stellen sind neutral und kostenlos. Empfiehl sie ehrlich, wenn sie der Person helfen (z. B. Antrag, Begutachtung, Widerspruch, Entlastung) – auch wenn ${company} ebenfalls hilft. Sag dazu, dass es offizielle bzw. unabhängige Stellen sind.
- Für den Pflegegrad-Antrag: zuerst bei der eigenen Pflegekasse anrufen (die Nummer steht auf der Rückseite der Krankenversicherungskarte bzw. auf der Website der Krankenkasse) und sagen „Ich beantrage Leistungen der Pflegeversicherung“; die Kasse schickt ihr Formular. Besser zusätzlich schriftlich, damit das Antragsdatum belegt ist.
${how}
${lines.join("\n")}`;
}
