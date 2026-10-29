"use client";

import { useEffect, useRef, useState } from "react";

type Task = { id: number; created_at: string; lead_id: number | null; title: string; due_text: string | null; done: boolean };
type Lead = {
  id: number;
  created_at: string;
  updated_at: string;
  source: "call" | "chat";
  name: string | null;
  phone: string | null;
  district: string | null;
  relation: string | null;
  care_level: string | null;
  needs: string | null;
  concern: string | null;
  notes: string | null;
  language: string | null;
  consent: boolean;
  status: "neu" | "in_arbeit" | "erledigt" | "spam";
  tasks: Task[];
};
type Ev = { id: number; created_at: string; lead_id: number | null; source: string; kind: string; detail: Record<string, unknown> };
type Snap = { leads: Lead[]; tasks: Task[]; events: Ev[] };

type L = "ru" | "de";
const TX = {
  ru: {
    title: "Заявки и клиенты",
    live: "в реальном времени",
    login: "Вход в CRM",
    password: "Пароль",
    enter: "Войти",
    wrong: "Неверный пароль",
    empty: "Пока нет записей. Позвоните помощнику на сайте — карточка появится здесь во время разговора.",
    feed: "Что делает ИИ",
    openTasks: "Открытые задачи",
    noTasks: "Задач нет",
    call: "Звонок",
    chat: "Чат",
    unknown: "Имя ещё не известно",
    district: "Район",
    relation: "Для кого",
    care: "Pflegegrad",
    needs: "Потребности",
    concern: "Вопрос",
    notes: "Заметки",
    tasks: "Задачи",
    status: { neu: "Новая", in_arbeit: "В работе", erledigt: "Готово", spam: "Спам" },
    kinds: { card_created: "Создана карточка", card_updated: "Карточка дополнена", task_created: "Создана задача", lead_status: "Статус изменён", task_done: "Задача отмечена" } as Record<string, string>,
    noConsent: "без согласия на контакт",
    ago: (s: number) => (s < 60 ? `${s} с назад` : s < 3600 ? `${Math.floor(s / 60)} мин назад` : `${Math.floor(s / 3600)} ч назад`),
    error: "Нет связи с базой. Пробую снова …",
  },
  de: {
    title: "Anfragen und Kunden",
    live: "in Echtzeit",
    login: "Anmeldung CRM",
    password: "Passwort",
    enter: "Anmelden",
    wrong: "Falsches Passwort",
    empty: "Noch keine Einträge. Rufen Sie den Assistenten auf der Website an – die Karte erscheint hier schon während des Gesprächs.",
    feed: "Was die KI gerade tut",
    openTasks: "Offene Aufgaben",
    noTasks: "Keine Aufgaben",
    call: "Anruf",
    chat: "Chat",
    unknown: "Name noch unbekannt",
    district: "Bezirk",
    relation: "Für wen",
    care: "Pflegegrad",
    needs: "Hilfebedarf",
    concern: "Anliegen",
    notes: "Notizen",
    tasks: "Aufgaben",
    status: { neu: "Neu", in_arbeit: "In Arbeit", erledigt: "Erledigt", spam: "Spam" },
    kinds: { card_created: "Karte angelegt", card_updated: "Karte ergänzt", task_created: "Aufgabe angelegt", lead_status: "Status geändert", task_done: "Aufgabe abgehakt" } as Record<string, string>,
    noConsent: "ohne Kontakt-Einwilligung",
    ago: (s: number) => (s < 60 ? `vor ${s} s` : s < 3600 ? `vor ${Math.floor(s / 60)} min` : `vor ${Math.floor(s / 3600)} h`),
    error: "Keine Verbindung zur Datenbank. Neuer Versuch …",
  },
};

const secondsAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function Crm({ companyName }: { companyName: string }) {
  const [lang, setLang] = useState<L>("ru");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [err, setErr] = useState(false);
  const [pwErr, setPwErr] = useState("");
  const [, tick] = useState(0);
  const seenEvents = useRef<Set<number>>(new Set());
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const t = TX[lang];

  useEffect(() => {
    try {
      const s = localStorage.getItem("crm-lang");
      if (s === "ru" || s === "de") setLang(s);
      else if (!/^ru/i.test(navigator.language)) setLang("de");
    } catch {}
  }, []);

  async function load() {
    try {
      const r = await fetch("/api/crm", { cache: "no-store" });
      if (r.status === 401) return setAuthed(false);
      if (!r.ok) throw new Error();
      const data = (await r.json()) as Snap;
      setAuthed(true);
      setErr(false);
      // Karten markieren, die gerade neue Ereignisse bekommen haben
      const first = seenEvents.current.size === 0;
      const newLeads = new Set<number>();
      for (const e of data.events) {
        if (!seenEvents.current.has(e.id)) {
          seenEvents.current.add(e.id);
          if (!first && e.lead_id) newLeads.add(e.lead_id);
        }
      }
      if (newLeads.size) {
        setFresh(newLeads);
        setTimeout(() => setFresh(new Set()), 2500);
      }
      setSnap(data);
    } catch {
      setErr(true);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
      tick((n) => n + 1);
    }, 1500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPwErr("");
    const password = new FormData(e.currentTarget).get("password");
    const r = await fetch("/api/crm/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (r.ok) load();
    else setPwErr(t.wrong);
  }

  async function update(kind: "lead_status" | "task_done", id: number, value: string) {
    await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, value }) });
    load();
  }

  const switchLang = (l: L) => {
    setLang(l);
    try { localStorage.setItem("crm-lang", l); } catch {}
  };

  if (authed === false) {
    return (
      <main className="unlock">
        <form onSubmit={login}>
          <h1>{t.login}</h1>
          <p>{companyName}</p>
          <input name="password" type="password" autoComplete="current-password" required autoFocus aria-label={t.password} placeholder={t.password} />
          {pwErr && <p className="form-error" role="alert">{pwErr}</p>}
          <button className="btn btn-primary">{t.enter}</button>
        </form>
      </main>
    );
  }

  const leads = snap?.leads ?? [];
  const openTasks = (snap?.tasks ?? []).filter((x) => !x.done);
  const leadName = (id: number | null) => {
    const l = leads.find((x) => x.id === id);
    return l ? l.name || `#${l.id}` : "";
  };

  return (
    <div className="crm">
      <header className="crm-top">
        <div>
          <h1>{t.title}</h1>
          <p className="crm-sub">
            {companyName} · <span className={`crm-live${err ? " off" : ""}`}>{err ? t.error : t.live}</span>
          </p>
        </div>
        <div className="lang" role="group" aria-label="Sprache / Язык">
          {(["ru", "de"] as L[]).map((l) => (
            <button key={l} aria-pressed={lang === l} onClick={() => switchLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
      </header>

      <div className="crm-grid">
        <section className="crm-cards" aria-label={t.title}>
          {snap && leads.length === 0 && <p className="crm-empty">{t.empty}</p>}
          {leads.map((l) => (
            <article key={l.id} className={`crm-card${fresh.has(l.id) ? " is-fresh" : ""}${l.status === "erledigt" || l.status === "spam" ? " is-done" : ""}`}>
              <div className="crm-card-head">
                <div>
                  <h2>{l.name || <span className="muted">{t.unknown}</span>}</h2>
                  <p className="crm-meta">
                    <span className={`src src-${l.source}`}>{l.source === "call" ? t.call : t.chat}</span>
                    {l.phone && <a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}>{l.phone}</a>}
                    {l.language && <span>{l.language.toUpperCase()}</span>}
                    <span title={new Date(l.updated_at).toLocaleString("de-DE")}>{t.ago(secondsAgo(l.updated_at))}</span>
                  </p>
                </div>
                <select value={l.status} onChange={(e) => update("lead_status", l.id, e.target.value)} aria-label="Status">
                  {(Object.keys(t.status) as (keyof typeof t.status)[]).map((k) => (
                    <option key={k} value={k}>{t.status[k]}</option>
                  ))}
                </select>
              </div>
              <dl>
                {l.district && (<><dt>{t.district}</dt><dd>{l.district}</dd></>)}
                {l.relation && (<><dt>{t.relation}</dt><dd>{l.relation}</dd></>)}
                {l.care_level && (<><dt>{t.care}</dt><dd>{l.care_level}</dd></>)}
                {l.needs && (<><dt>{t.needs}</dt><dd>{l.needs}</dd></>)}
                {l.concern && (<><dt>{t.concern}</dt><dd>{l.concern}</dd></>)}
                {l.notes && (<><dt>{t.notes}</dt><dd className="pre">{l.notes}</dd></>)}
              </dl>
              {!l.consent && <p className="crm-note">{t.noConsent}</p>}
              {l.tasks.length > 0 && (
                <ul className="crm-tasks">
                  {l.tasks.map((x) => (
                    <li key={x.id}>
                      <label>
                        <input type="checkbox" checked={x.done} onChange={(e) => update("task_done", x.id, String(e.target.checked))} />
                        <span className={x.done ? "done" : ""}>{x.title}{x.due_text ? ` — ${x.due_text}` : ""}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </section>

        <aside className="crm-side">
          <section>
            <h3>{t.openTasks}</h3>
            {openTasks.length === 0 ? (
              <p className="muted">{t.noTasks}</p>
            ) : (
              <ul className="crm-tasks">
                {openTasks.map((x) => (
                  <li key={x.id}>
                    <label>
                      <input type="checkbox" checked={false} onChange={() => update("task_done", x.id, "true")} />
                      <span>
                        {x.title}
                        {x.due_text ? ` — ${x.due_text}` : ""}
                        {x.lead_id ? <em> · {leadName(x.lead_id)}</em> : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>{t.feed}</h3>
            <ol className="crm-feed">
              {(snap?.events ?? []).map((e) => (
                <li key={e.id}>
                  <time>{timeOf(e.created_at)}</time>
                  <span className={`src src-${e.source === "call" ? "call" : e.source === "chat" ? "chat" : "crm"}`}>{e.source}</span>
                  <strong>{t.kinds[e.kind] ?? e.kind}</strong>
                  <span className="feed-detail">
                    {Object.entries(e.detail || {})
                      .filter(([, v]) => v !== null && v !== "" && typeof v !== "object")
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(" · ")
                      .slice(0, 160)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
