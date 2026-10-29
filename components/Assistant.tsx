"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BCP47, LANGS, T, detectLang, type Lang } from "@/lib/i18n";
import type { Company } from "@/lib/tenant";
import LeadForm from "./LeadForm";

const CallOverlay = dynamic(() => import("./CallOverlay"), { ssr: false });

type Msg = { id: string; role: "user" | "assistant"; content: string; lead?: boolean; error?: boolean };
type Config = { chat: boolean; voiceCall: boolean; serverSpeech: boolean };
type MicState = "idle" | "recording" | "transcribing" | "browser";

const MARKER = "[[RUECKRUF]]";
const uid = () => Math.random().toString(36).slice(2, 10);

function visible(text: string) {
  // Markdown-Reste (z. B. **fett**) entfernen – die Antwort wird als einfacher Text gezeigt
  let s = text.replaceAll(MARKER, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "");
  // während des Streamens ein angefangenes „[[…“ am Ende verstecken
  const open = s.lastIndexOf("[[");
  if (open !== -1 && !s.slice(open).includes("]]") && MARKER.startsWith(s.slice(open))) s = s.slice(0, open);
  return s.trim();
}

export default function Assistant({
  company,
  demo,
  embedded = false,
}: {
  company: Company;
  demo: { show: boolean; author: string };
  embedded?: boolean;
}) {
  const [lang, setLang] = useState<Lang>("de");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [mic, setMic] = useState<MicState>("idle");
  const [hint, setHint] = useState("");
  const [readAloud, setReadAloud] = useState(false);
  const [leadDone, setLeadDone] = useState(false);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speechRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const t = T[lang];

  useEffect(() => {
    setLang(detectLang());
    try { setReadAloud(localStorage.getItem("va-read") === "1"); } catch {}
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setCfg(c ?? { chat: false, voiceCall: false, serverSpeech: false }))
      .catch(() => setCfg({ chat: false, voiceCall: false, serverSpeech: false }));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem("va-lang", lang); } catch {}
  }, [lang]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  function toggleRead() {
    const v = !readAloud;
    setReadAloud(v);
    try { localStorage.setItem("va-read", v ? "1" : "0"); } catch {}
    if (!v) stopSpeaking();
  }

  function stopSpeaking() {
    audioRef.current?.pause();
    try { window.speechSynthesis?.cancel(); } catch {}
  }

  async function speak(text: string) {
    if (!readAloud || !text) return;
    stopSpeaking();
    const spokenLang: Lang = /[а-яё]/i.test(text) ? "ru" : /[äöüß]/i.test(text) ? "de" : lang;
    if (cfg?.serverSpeech) {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, lang: spokenLang }),
        });
        if (res.ok) {
          const url = URL.createObjectURL(await res.blob());
          const a = audioRef.current ?? new Audio();
          audioRef.current = a;
          a.src = url;
          a.onended = () => URL.revokeObjectURL(url);
          await a.play();
          return;
        }
      } catch {}
    }
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = BCP47[spokenLang];
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch {}
  }

  async function send(textRaw: string) {
    const text = textRaw.trim();
    if (!text || busy) return;
    stopSpeaking();
    setHint("");
    setInput("");
    const user: Msg = { id: uid(), role: "user", content: text };
    const bot: Msg = { id: uid(), role: "assistant", content: "" };
    const history = [...msgs, user];
    setMsgs([...history, bot]);
    setBusy(true);
    setSlow(false);
    // Wenn der KI-Dienst überlastet ist, dauert es länger – dann einen Hinweis zeigen
    const slowTimer = setTimeout(() => setSlow(true), 8000);

    let full = "";
    try {
      const body = JSON.stringify({
        messages: history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
      });
      let res: Response | null = null;
      // Bei Überlastung (5xx) einmal automatisch neu versuchen
      for (let attempt = 0; attempt < 2; attempt++) {
        res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        if (res.ok || res.status < 500 || attempt === 1) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!res || !res.ok || !res.body) {
        const data = await res?.json().catch(() => ({}));
        throw new Error(res && res.status >= 500 ? "error" : data?.error || "error");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
        const shown = full;
        setMsgs((prev) => prev.map((m) => (m.id === bot.id ? { ...m, content: shown } : m)));
      }
      const wantsLead = full.includes(MARKER) && !leadDone;
      setMsgs((prev) => prev.map((m) => (m.id === bot.id ? { ...m, content: full, lead: wantsLead } : m)));
      speak(visible(full));
    } catch (e) {
      const msg = e instanceof Error && e.message !== "error" ? e.message : t.errorGeneric;
      setMsgs((prev) =>
        prev.map((m) => (m.id === bot.id ? { ...m, content: `${msg} ${company.phone}`, error: true } : m)),
      );
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
      setBusy(false);
    }
  }

  // ---------- Mikrofon ----------
  // Nach so viel Stille gilt die Frage als fertig und wird automatisch gesendet
  const SILENCE_MS = 1000;

  async function micPress() {
    // Zweiter Druck = sofort fertig
    if (mic === "recording") {
      recRef.current?.stop();
      return;
    }
    if (mic === "browser") {
      speechRef.current?.finish?.();
      return;
    }
    if (mic === "transcribing") return;
    stopSpeaking();
    setHint("");

    // 1) Schnellster Weg: Spracherkennung des Browsers (Chrome, Edge, Android, Safari).
    //    Text erscheint schon beim Sprechen, nach 1 s Stille wird gesendet.
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      try {
        const r = new SR();
        r.lang = BCP47[lang];
        r.interimResults = true;
        r.continuous = true;
        let finalText = "";
        let interim = "";
        let done = false;
        let silence: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(silence);
          try { r.stop(); } catch {}
          setMic("idle");
          const text = (finalText + " " + interim).replace(/\s+/g, " ").trim();
          if (text) send(text);
          else setInput("");
        };
        r.finish = finish;
        r.onresult = (e: any) => {
          interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const s = e.results[i][0].transcript;
            if (e.results[i].isFinal) finalText += " " + s;
            else interim += s;
          }
          setInput((finalText + " " + interim).replace(/\s+/g, " ").trim());
          clearTimeout(silence);
          silence = setTimeout(finish, SILENCE_MS);
        };
        r.onend = finish;
        r.onerror = (e: any) => {
          if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
            done = true;
            setMic("idle");
            setHint(t.callMicDenied);
            return;
          }
          finish();
        };
        speechRef.current = r;
        r.start();
        setMic("browser");
        return;
      } catch {
        /* weiter zu Variante 2 */
      }
    }

    // 2) Browser ohne eigene Spracherkennung (z. B. Firefox): Aufnahme → Server (Gemini).
    //    Aufnahme stoppt selbst nach 1 s Stille.
    if (cfg?.serverSpeech && typeof MediaRecorder !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m));
        const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
        chunksRef.current = [];

        // Stille-Erkennung über die Lautstärke
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        let heard = false;
        let quietSince = Date.now();
        const vad = setInterval(() => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const loud = Math.sqrt(sum / buf.length) > 0.02;
          if (loud) {
            heard = true;
            quietSince = Date.now();
          } else if (heard && Date.now() - quietSince > SILENCE_MS && rec.state === "recording") {
            rec.stop();
          } else if (!heard && Date.now() - quietSince > 8000 && rec.state === "recording") {
            rec.stop(); // gar nichts gesagt
          }
        }, 100);

        rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
        rec.onstop = async () => {
          clearInterval(vad);
          ctx.close().catch(() => {});
          stream.getTracks().forEach((tr) => tr.stop());
          if (!heard) {
            setMic("idle");
            return;
          }
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          setMic("transcribing");
          try {
            const fd = new FormData();
            fd.append("audio", blob);
            fd.append("lang", lang);
            const res = await fetch("/api/transcribe", { method: "POST", body: fd });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "");
            setMic("idle");
            if (data.text) send(data.text);
          } catch {
            setMic("idle");
            setHint(t.errorGeneric + " " + company.phone);
          }
        };
        recRef.current = rec;
        rec.start();
        setMic("recording");
        setTimeout(() => rec.state === "recording" && rec.stop(), 60_000);
        return;
      } catch {
        /* weiter zu Variante 3 */
      }
    }

    // 3) Rückfall: Mikrofon der Handy-Tastatur
    setHint(t.micKeyboard);
    inputRef.current?.focus();
  }

  const started = msgs.length > 0;
  const chatReady = cfg?.chat ?? true;

  return (
    <div className={`app${embedded ? " is-embedded" : ""}`}>
      {demo.show && <div className="demo-strip">{t.demo(demo.author, company.shortName)}</div>}

      <header className="top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">{company.shortName.slice(0, 1)}</span>
          <div>
            <p className="brand-name">
              <span className="long">{company.name}</span>
              <span className="short">{company.shortName}</span>
            </p>
            <p className="brand-tag">{company.tagline[lang]}</p>
          </div>
        </div>
        <div className="top-actions">
          <div className="lang" role="group" aria-label="Sprache / Язык">
            {LANGS.map((l) => (
              <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={() => setContactOpen(true)} aria-label={t.contact}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.25 1z"/></svg>
          </button>
        </div>
      </header>

      <main className="thread" ref={threadRef} aria-live="polite">
        <section className="intro">
          <p className="hello">{t.hello(company.shortName)}</p>

          {cfg?.voiceCall && (
            <button className="call-cta" onClick={() => setCallOpen(true)}>
              <span className="call-disc" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="32" height="32"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.25 1z"/></svg>
              </span>
              <span className="call-words">
                <strong>{t.callTitle}</strong>
                <span>{t.callSub}</span>
              </span>
            </button>
          )}

          {!started && chatReady && (
            <div className="chips">
              {company.quickQuestions[lang].map((q) => (
                <button key={q} className="chip" onClick={() => send(q)}>{q}</button>
              ))}
            </div>
          )}

          {cfg && !cfg.chat && (
            <p className="notice">
              {t.unavailable} <a href={`tel:${company.phoneHref}`}>{company.phone}</a>
            </p>
          )}
        </section>

        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.role}${m.error ? " error" : ""}`}>
            {m.role === "assistant" && !m.content ? (
              <>
                <span className="typing" aria-label={t.thinking}><i /><i /><i /></span>
                {slow && <p className="slow-note">{t.slow}</p>}
              </>
            ) : (
              <p>{m.role === "assistant" ? visible(m.content) : m.content}</p>
            )}
            {m.lead && !leadDone &&
              (openLead === m.id ? (
                <LeadForm lang={lang} onDone={() => setLeadDone(true)} />
              ) : (
                <button className="lead-open" onClick={() => setOpenLead(m.id)}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.25 1z"/></svg>
                  {t.leadOpen}
                </button>
              ))}
          </div>
        ))}
      </main>

      <footer className="composer">
        {hint && <p className="hint" role="status">{hint}</p>}
        <form
          className="bar"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <button
            type="button"
            className={`mic mic-${mic}`}
            onClick={micPress}
            aria-label={mic === "recording" || mic === "browser" ? t.micStop : t.micHold}
            title={mic === "recording" || mic === "browser" ? t.micStop : t.micHold}
            disabled={!chatReady}
          >
            {mic === "recording" || mic === "browser" ? (
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12z"/></svg>
            )}
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={t.placeholder}
            aria-label={t.placeholder}
            maxLength={2000}
            disabled={!chatReady}
            enterKeyHint="send"
          />
          <button className="send" type="submit" disabled={busy || !input.trim()} aria-label={t.send}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.39 10.1 15 12 3.39 13.9z"/></svg>
          </button>
        </form>
        <div className="foot">
          <label className="switch">
            <input type="checkbox" checked={readAloud} onChange={toggleRead} />
            <span>{t.readAloud}</span>
          </label>
          <span className="ai-note">{t.aiNote}</span>
        </div>
      </footer>

      {contactOpen && (
        <div className="sheet-wrap" onClick={() => setContactOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={t.contact} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>{t.contact}</h2>
              <button className="icon-btn" onClick={() => setContactOpen(false)} aria-label={t.close}>✕</button>
            </div>
            <a className="btn btn-primary wide" href={`tel:${company.phoneHref}`}>{t.callUs}: {company.phone}</a>
            <p className="sheet-hours">{company.hours[lang]}</p>
            <ul className="locs">
              {company.locations.map((l) => (
                <li key={l.label}>
                  <strong>{l.label}</strong>
                  <span>{l.address}</span>
                  <a href={`tel:${l.phone.replace(/[^\d+]/g, "").replace(/^0/, "+49")}`}>{l.phone}</a>
                </li>
              ))}
            </ul>
            {!leadDone && <LeadForm lang={lang} onDone={() => setLeadDone(true)} />}
            <p className="privacy">{t.privacy}</p>
          </div>
        </div>
      )}

      {callOpen && (
        <CallOverlay
          lang={lang}
          companyName={company.name}
          phone={company.phone}
          phoneHref={company.phoneHref}
          onClose={(s) => {
            setCallOpen(false);
            if (s?.leadSaved) setLeadDone(true);
          }}
        />
      )}
    </div>
  );
}
