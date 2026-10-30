"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BCP47, LANGS, T, detectLang, type Lang } from "@/lib/i18n";
import type { Company } from "@/lib/tenant";
import LeadForm from "./LeadForm";
import { addCaptureWorklet, rms, toBase64 } from "@/lib/pcm";
import { conversationId, deleteSession, devMode, listSessions, loadHistory, newSession, resetDevice, saveHistory, switchSession, type Session } from "@/lib/device";
import { Choices, DocCard, MapCard, TimePicker, parseBlocks, plainText } from "./ChatBlocks";
import { LINK_HOSTS } from "@/lib/resources";
import { spokenLang } from "@/lib/speechlang";

const CallOverlay = dynamic(() => import("./CallOverlay"), { ssr: false });

type Msg = { id: string; role: "user" | "assistant"; content: string; lead?: boolean; error?: boolean; final?: boolean; call?: boolean; at?: number };
type MyLead = { id: number; name: string | null; phone: string | null; district: string | null; status: "neu" | "in_arbeit" | "erledigt" | "spam"; consent: boolean };
type Config = { chat: boolean; voiceCall: boolean; serverSpeech: boolean };
type MicState = "idle" | "recording" | "transcribing" | "live";

const MARKER = "[[RUECKRUF]]";
const uid = () => Math.random().toString(36).slice(2, 10);

function visible(text: string) {
  // Markdown-Reste (z. B. **fett**) entfernen – die Antwort wird als einfacher Text gezeigt
  let s = plainText(text).replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "");
  // während des Streamens ein angefangenes „[[…“ am Ende verstecken
  const open = s.lastIndexOf("[[");
  if (open !== -1 && !s.slice(open).includes("]]") && MARKER.startsWith(s.slice(open))) s = s.slice(0, open);
  return s.trim();
}

// Links nur zu geprüften offiziellen Seiten und zur Firmenseite klickbar machen; Telefonnummern zum Anrufen.
const URL_RE = /(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])|((?:\+49|0)\d[\d\s/-]{6,}\d)/g;
function linkify(text: string, extraHosts: string[] = []): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    if (m[1]) {
      let ok = false;
      try {
        const host = new URL(m[1]).hostname.replace(/^www\./, "");
        ok = [...LINK_HOSTS, ...extraHosts].some((h) => host === h || host.endsWith("." + h));
      } catch {}
      out.push(ok ? <a key={k++} href={m[1]} target="_blank" rel="noopener noreferrer">{m[1].replace(/^https?:\/\/(www\.)?/, "")}</a> : m[1]);
    } else {
      out.push(<a key={k++} href={`tel:${m[2].replace(/[^\d+]/g, "")}`}>{m[2]}</a>);
    }
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
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
  const [speaking, setSpeaking] = useState<{ id: string; phase: "loading" | "playing" } | null>(null);
  const audioCache = useRef<Map<string, string>>(new Map());
  const [conv, setConv] = useState("");
  const [dev, setDev] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [myLead, setMyLead] = useState<MyLead | null>(null);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const t = T[lang];
  const companyHost = (() => { try { return new URL(company.website).hostname.replace(/^www\./, ""); } catch { return ""; } })();

  // Gedächtnis dieses Geräts: Verlauf + Verbindung zur eigenen Anfrage
  useEffect(() => {
    const id = conversationId();
    setConv(id);
    const past = loadHistory(id);
    if (past.length) setMsgs(past.map((m) => ({ ...m, final: true })));
    refreshLead(id);
    const isDev = devMode();
    setDev(isDev);
    if (isDev) setSessions(listSessions());
  }, []);

  useEffect(() => {
    if (!busy && conv) {
      saveHistory(msgs.filter((m) => !m.error && m.content).map(({ id, role, content, call, at }) => ({ id, role, content, call, at })), conv);
      if (dev) setSessions(listSessions());
    }
  }, [msgs, busy, conv, dev]);

  async function refreshLead(id = conv) {
    if (!id) return;
    try {
      const r = await fetch("/api/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: id }) });
      const d = await r.json();
      setMyLead(d?.lead ?? null);
    } catch {}
  }

  // ---------- Sitzungen (Entwicklermodus) ----------
  function openSession(id: string) {
    stopSpeaking();
    setConv(id);
    setMsgs(loadHistory(id).map((m) => ({ ...m, final: true })));
    setMyLead(null);
    refreshLead(id);
    setSessions(listSessions());
  }
  const devNew = () => openSession(newSession());
  const devSwitch = (id: string) => openSession(switchSession(id));
  function devDelete() {
    if (!window.confirm("Diese Sitzung auf dem Gerät löschen? (CRM bleibt)")) return;
    deleteSession(conv);
    openSession(conversationId());
  }
  function devReset() {
    if (!window.confirm("Alle Sitzungen und den Verlauf auf diesem Gerät löschen?")) return;
    resetDevice();
    openSession(conversationId());
  }

  // Veraltete Seite (neue Version veröffentlicht): beim Zurückkehren neu laden, wenn gerade nichts läuft
  const busyRef = useRef(false);
  const callOpenRef = useRef(false);
  useEffect(() => { busyRef.current = busy; callOpenRef.current = callOpen; });
  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "";
    if (!mine) return;
    const check = async () => {
      if (document.visibilityState !== "visible" || busyRef.current || callOpenRef.current) return;
      try {
        const c = await fetch("/api/config", { cache: "no-store" }).then((r) => r.json());
        if (c?.build && c.build !== mine) location.reload();
      } catch {}
    };
    const id = setInterval(check, 5 * 60_000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", check); };
  }, []);

  useEffect(() => {
    setLang(detectLang());
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

  function stopSpeaking() {
    audioRef.current?.pause();
    try { window.speechSynthesis?.cancel(); } catch {}
    setSpeaking(null);
  }

  /** Antwort vorlesen – nur auf Knopfdruck am jeweiligen Text. Zweiter Druck stoppt. */
  async function speak(id: string, text: string) {
    if (speaking?.id === id) return stopSpeaking();
    stopSpeaking();
    if (!text) return;
    const spokenLang: Lang = /[а-яё]/i.test(text) ? "ru" : /[äöüß]/i.test(text) ? "de" : lang;
    const play = async (url: string) => {
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.src = url;
      a.onended = () => setSpeaking((s) => (s?.id === id ? null : s));
      a.onpause = () => setSpeaking((s) => (s?.id === id ? null : s));
      setSpeaking({ id, phase: "playing" });
      await a.play();
    };
    const cached = audioCache.current.get(id);
    if (cached) return play(cached).catch(() => setSpeaking(null));
    setSpeaking({ id, phase: "loading" });
    if (cfg?.serverSpeech) {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, lang: spokenLang }),
        });
        if (res.ok) {
          const url = URL.createObjectURL(await res.blob());
          audioCache.current.set(id, url);
          return await play(url);
        }
      } catch {}
    }
    // Rückfall: Stimme des Geräts
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = BCP47[spokenLang];
      u.onend = () => setSpeaking(null);
      setSpeaking({ id, phase: "playing" });
      window.speechSynthesis.speak(u);
    } catch {
      setSpeaking(null);
    }
  }

  async function send(textRaw: string) {
    const text = textRaw.trim();
    if (!text || busy) return;
    stopSpeaking();
    setHint("");
    setInput("");
    const user: Msg = { id: uid(), role: "user", content: text, at: Date.now() };
    const bot: Msg = { id: uid(), role: "assistant", content: "", at: Date.now() };
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
        conversationId: conv,
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
      const wantsLead = full.includes(MARKER);
      setMsgs((prev) => prev.map((m) => (m.id === bot.id ? { ...m, content: full, lead: wantsLead, final: true } : m)));
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

  // ---------- Mikrofon: Gemini-Echtzeit-Spracherkennung ----------
  // Nach so viel Stille gilt die Frage als fertig und wird automatisch gesendet
  const SILENCE_MS = 1000;
  const dictRef = useRef<{ finish: () => void } | null>(null);

  async function micPress() {
    // Zweiter Druck = sofort fertig
    if (mic === "live") {
      dictRef.current?.finish();
      return;
    }
    if (mic === "recording") {
      recRef.current?.stop();
      return;
    }
    if (mic === "transcribing") return;
    stopSpeaking();
    setHint("");
    const ok = await liveDictation();
    if (!ok) await recordAndTranscribe();
  }

  /** gemini-3.5-transcribe-live: Text erscheint beim Sprechen, Sprache wird automatisch erkannt. */
  async function liveDictation(): Promise<boolean> {
    if (!cfg?.serverSpeech || !navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") return false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch {
      setHint(t.callMicDenied);
      return true; // nicht auf andere Wege ausweichen – das Mikrofon ist gesperrt
    }

    const ctx = new AudioContext();
    let session: any = null;
    let finals = "";
    let interim = "";
    let done = false;
    let ending = false;
    let heard = false;
    let quietSince = Date.now();
    const startedAt = Date.now();
    const pending: string[] = [];
    let endTimer: ReturnType<typeof setTimeout> | undefined;

    const show = () => setInput((finals + " " + interim).replace(/\s+/g, " ").trim());

    const cleanup = () => {
      clearTimeout(endTimer);
      stream.getTracks().forEach((tr) => tr.stop());
      ctx.close().catch(() => {});
      try { session?.close(); } catch {}
      dictRef.current = null;
    };

    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      setMic("idle");
      const text = (finals + " " + interim).replace(/\s+/g, " ").trim();
      if (text) send(text);
      else setInput("");
    };

    // Sprechpause erkannt → Server bitten, sofort abzuschließen; kurz auf den endgültigen Text warten
    const endTurn = () => {
      if (ending || done) return;
      ending = true;
      try { session?.sendRealtimeInput({ audioStreamEnd: true }); } catch {}
      endTimer = setTimeout(finish, 1200);
    };
    dictRef.current = { finish: () => (session ? endTurn() : finish()) };

    try {
      await addCaptureWorklet(ctx);
      const node = new AudioWorkletNode(ctx, "capture-16k", { processorOptions: { chunk: 1600 } }); // 100 ms
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (done || ending) return;
        // Stille-Erkennung
        if (rms(e.data) > 0.015) {
          heard = true;
          quietSince = Date.now();
        } else if (heard && Date.now() - quietSince > SILENCE_MS) {
          endTurn();
        } else if (!heard && Date.now() - startedAt > 8000) {
          finish(); // gar nichts gesagt
          return;
        }
        if (Date.now() - startedAt > 60_000) endTurn();
        const b64 = toBase64(e.data);
        if (session) {
          try { session.sendRealtimeInput({ audio: { data: b64, mimeType: "audio/pcm;rate=16000" } }); } catch {}
        } else {
          pending.push(b64); // Anfang nicht verlieren, solange die Verbindung aufgebaut wird
        }
      };
      ctx.createMediaStreamSource(stream).connect(node);
      setMic("live");

      const res = await fetch("/api/stt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: speechLang }) });
      const tok = await res.json().catch(() => ({}));
      if (!res.ok || !tok.token) throw new Error(tok.error || "token");

      const { GoogleGenAI, Modality } = await import("@google/genai");
      const connect = (apiVersion: "v1beta" | "v1alpha") =>
        new Promise<any>((resolve, reject) => {
          let ready = false;
          let gotMsg = false;
          let s: any = null;
          const tryResolve = () => {
            if (!ready && gotMsg && s) {
              ready = true;
              resolve(s);
            }
          };
          new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion } }).live
            .connect({
              model: tok.model,
              config: { responseModalities: [Modality.TEXT] },
              callbacks: {
                onmessage: (m: any) => {
                  gotMsg = true;
                  tryResolve();
                  const sc = m?.serverContent;
                  if (!sc) return;
                  if (sc.interimInputTranscription?.text != null) {
                    interim = sc.interimInputTranscription.text;
                    show();
                  }
                  if (sc.inputTranscription?.text) {
                    finals += " " + sc.inputTranscription.text;
                    interim = "";
                    show();
                    if (ending) finish(); // endgültiger Text nach der Pause ist da
                  }
                },
                onerror: (e: unknown) => console.warn("stt error", apiVersion, e),
                onclose: () => {
                  if (!ready) reject(new Error("closed"));
                  else if (!done) finish();
                },
              },
            })
            .then((x) => {
              s = x;
              tryResolve();
              setTimeout(() => !ready && reject(new Error("setup timeout")), 8000);
            }, reject);
        });

      try {
        session = await connect("v1beta");
      } catch {
        session = await connect("v1alpha");
      }
      if (done) {
        try { session.close(); } catch {}
        return true;
      }
      // Was vor dem Verbindungsaufbau gesprochen wurde, jetzt nachsenden
      for (const b64 of pending.splice(0)) session.sendRealtimeInput({ audio: { data: b64, mimeType: "audio/pcm;rate=16000" } });
      if (ending) session.sendRealtimeInput({ audioStreamEnd: true });
      return true;
    } catch (e) {
      console.warn("live dictation failed, using server fallback", e);
      done = true;
      cleanup();
      setMic("idle");
      return false;
    }
  }

  /** Rückfall: Aufnahme → Server (gemini-3.5-transcribe), stoppt selbst nach 1 s Stille. */
  async function recordAndTranscribe() {
    if (!cfg?.serverSpeech || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setHint(t.micKeyboard);
      inputRef.current?.focus();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m));
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunksRef.current = [];
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
        if (Math.sqrt(sum / buf.length) > 0.02) {
          heard = true;
          quietSince = Date.now();
        } else if (heard && Date.now() - quietSince > SILENCE_MS && rec.state === "recording") rec.stop();
        else if (!heard && Date.now() - quietSince > 8000 && rec.state === "recording") rec.stop();
      }, 100);
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        clearInterval(vad);
        ctx.close().catch(() => {});
        stream.getTracks().forEach((tr) => tr.stop());
        if (!heard) return setMic("idle");
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setMic("transcribing");
        try {
          const fd = new FormData();
          fd.append("audio", blob);
          fd.append("lang", speechLang);
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
    } catch {
      setHint(t.callMicDenied);
    }
  }

  const started = msgs.length > 0;
  // Sprache für die Spracherkennung: getippte Nachrichten der Person (Anruf-Mitschriften können falsch erkannt sein), sonst Website-Sprache
  const speechLang = spokenLang(msgs.filter((m) => m.role === "user" && !m.call).map((m) => m.content), lang);
  const lastAssistantId = [...msgs].reverse().find((m) => m.role === "assistant")?.id;
  const chatReady = cfg?.chat ?? true;

  return (
    <div className={`app${embedded ? " is-embedded" : ""}`}>
      <header className="top">
        <div className="lang" role="group" aria-label="Sprache / Язык">
          {LANGS.map((l) => (
            <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="top-actions">
          <button className="icon-btn small" onClick={() => setContactOpen(true)} aria-label={t.contact} title={t.contact}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          </button>
          {cfg?.voiceCall && (
            <button className="call-btn" onClick={() => setCallOpen(true)} aria-label={t.callTitle} title={t.callTitle}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.25 1z"/></svg>
            </button>
          )}
        </div>
      </header>

      <main className="thread" ref={threadRef} aria-live="polite">
        {dev && (
          <div className="devbar">
            <select value={conv} onChange={(e) => devSwitch(e.target.value)} aria-label="Sitzung">
              {sessions.map((x) => (
                <option key={x.id} value={x.id}>
                  {new Date(x.updated).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {x.title || "(leer)"}
                </option>
              ))}
            </select>
            <button type="button" onClick={devNew} title="Neue Sitzung">＋</button>
            <button type="button" onClick={devDelete} title="Sitzung löschen">🗑</button>
            <button type="button" onClick={devReset} title="Alles zurücksetzen">⟲</button>
            <code title={conv}>{conv.slice(0, 8)}{myLead ? ` · #${myLead.id}` : ""}</code>
          </div>
        )}
        <section className="intro">
          <p className="hello">{myLead?.name ? t.welcomeBack(myLead.name) : t.hello(company.shortName)}</p>

          {myLead && (
            <div className="my-lead" role="status">
              <span>
                {t.myLead(myLead.id)} · <strong>{t.leadStatus[myLead.status]}</strong>
                {myLead.phone ? <> · {myLead.phone}</> : null}
              </span>
            </div>
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
          <div key={m.id} className={`msg ${m.role}${m.error ? " error" : ""}${m.call ? " via-call" : ""}`}>
            {m.call && <span className="via-call-tag">{t.viaCall}</span>}
            {m.role === "assistant" && !m.content ? (
              <>
                <span className="typing" aria-label={t.thinking}><i /><i /><i /></span>
                {slow && <p className="slow-note">{t.slow}</p>}
              </>
            ) : m.role === "user" ? (
              <p>{m.content}</p>
            ) : (
              parseBlocks(m.content).map((b, bi) => {
                const isLast = m.id === lastAssistantId && !busy;
                if (b.kind === "text") return <p key={bi}>{linkify(b.text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, ""), [companyHost])}</p>;
                if (b.kind === "doc") return <DocCard key={bi} id={b.id} lang={lang} />;
                if (b.kind === "map") return <MapCard key={bi} id={b.id} lang={lang} locations={company.locations} company={company.shortName} />;
                if (b.kind === "choices") return m.final ? <Choices key={bi} options={b.options} disabled={!isLast} onPick={(v) => send(v)} /> : null;
                if (b.kind === "time") return m.final && isLast ? <TimePicker key={bi} lang={lang} onPick={(v) => send(v)} /> : null;
                if (b.kind === "lead" && m.final && !m.error)
                  return openLead === m.id ? (
                    <LeadForm key={bi} lang={lang} conversationId={conv} initial={myLead} onDone={() => refreshLead()} />
                  ) : (
                    <button key={bi} className="lead-open" onClick={() => setOpenLead(m.id)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.25 1z"/></svg>
                      {myLead ? t.leadChange : t.leadOpen}
                    </button>
                  );
                return null;
              })
            )}
            {m.role === "assistant" && m.final && !m.error && !m.call && (
              <button
                className={`speak${speaking?.id === m.id ? ` is-${speaking.phase}` : ""}`}
                onClick={() => speak(m.id, visible(m.content))}
                aria-label={speaking?.id === m.id ? t.stopReading : t.readAloud}
                title={speaking?.id === m.id ? t.stopReading : t.readAloud}
              >
                {speaking?.id === m.id && speaking.phase === "playing" ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z"/></svg>
                )}
              </button>
            )}
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
          <div className={`field${mic === "recording" || mic === "live" ? " is-listening" : ""}`}>
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
              placeholder={mic === "live" || mic === "recording" ? t.micStop : t.placeholder}
              aria-label={t.placeholder}
              maxLength={2000}
              disabled={!chatReady}
              enterKeyHint="send"
            />
            {input.trim() && mic === "idle" ? (
              <button className="send" type="submit" disabled={busy} aria-label={t.send}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.39 10.1 15 12 3.39 13.9z"/></svg>
              </button>
            ) : (
              <button
                type="button"
                className={`mic mic-${mic}`}
                onClick={micPress}
                aria-label={mic === "recording" || mic === "live" ? t.micStop : t.micHold}
                title={mic === "recording" || mic === "live" ? t.micStop : t.micHold}
                disabled={!chatReady}
              >
                {mic === "recording" || mic === "live" ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12z"/></svg>
                )}
              </button>
            )}
          </div>
        </form>
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
            <LeadForm lang={lang} conversationId={conv} initial={myLead} onDone={() => refreshLead()} />
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
          conversationId={conv}
          speechLang={speechLang}
          locations={company.locations}
          lastAt={[...msgs].reverse().find((m) => m.at)?.at}
          history={msgs.filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: visible(m.content) }))}
          onClose={(s) => {
            setCallOpen(false);
            // Mitschrift des Anrufs in den Verlauf übernehmen
            if (s?.transcript?.length) {
              const at = Date.now();
              setMsgs((prev) => [...prev, ...s.transcript.map((x) => ({ id: uid(), role: x.role, content: x.content, call: true, final: true, at }))]);
            }
            refreshLead();
          }}
        />
      )}
    </div>
  );
}
