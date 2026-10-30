"use client";

import { useEffect, useRef, useState } from "react";
import { T, type Lang } from "@/lib/i18n";
import { addCaptureWorklet, toBase64 } from "@/lib/pcm";
import { RESOURCES, resourceFile, resourceUrl, type Resource } from "@/lib/resources";
import { TimePicker } from "./ChatBlocks";
import { formatPhone, phoneOk } from "@/lib/phone";
import { mapEmbed, mapRoute, officeId, type Office } from "@/lib/offices";

type Line = { who: "user" | "bot"; text: string; id: number };
type Phase = "connecting" | "listening" | "speaking" | "ended" | "error";

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default function CallOverlay({
  lang,
  companyName,
  phone,
  phoneHref,
  conversationId,
  history,
  lastAt,
  locations,
  onClose,
}: {
  lang: Lang;
  companyName: string;
  phone: string;
  phoneHref: string;
  conversationId: string;
  history: { role: "user" | "assistant"; content: string }[];
  lastAt?: number;
  locations: Office[];
  onClose: (summary?: { leadSaved: boolean; transcript: { role: "user" | "assistant"; content: string }[] }) => void;
}) {
  const t = T[lang];
  const [phase, setPhase] = useState<Phase>("connecting");
  const started = true;
  const [error, setError] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  const [leadSaved, setLeadSaved] = useState(false);

  const sessionRef = useRef<any>(null);
  const micRef = useRef<MediaStream | null>(null);
  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const outGainRef = useRef<GainNode | null>(null);
  const playheadRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const ringRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const endedRef = useRef(false);
  const leadRef = useRef(false);
  const lineIdRef = useRef(0);
  const curRef = useRef<{ user: number | null; bot: number | null }>({ user: null, bot: null });
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Auflegen nach dem Abschied: erst, wenn der Assistent zu Ende gesprochen hat
  const lastAudioRef = useRef(0);
  const endingRef = useRef(false);
  function endAfterGoodbye() {
    if (endingRef.current || endedRef.current) return;
    endingRef.current = true;
    const since = Date.now();
    const check = setInterval(() => {
      if (endedRef.current) return clearInterval(check);
      const now = Date.now();
      const quiet = sourcesRef.current.size === 0 && now - lastAudioRef.current > 1200;
      // Abschied schon gesprochen (Audio nach der Bitte) und fertig – oder gar kein Audio mehr nach 4 s
      const spokeAfter = lastAudioRef.current > since;
      if ((quiet && (spokeAfter || now - since > 4000)) || now - since > 12_000) {
        clearInterval(check);
        hangup();
      }
    }, 250);
  }

  function hangup() {
    if (endedRef.current) return;
    endedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    clearInterval(timerRef.current);
    try { sessionRef.current?.close(); } catch {}
    micRef.current?.getTracks().forEach((tr) => tr.stop());
    stopPlayback();
    inCtxRef.current?.close().catch(() => {});
    outCtxRef.current?.close().catch(() => {});
    setPhase((p) => (p === "error" ? p : "ended"));
  }

  function stopPlayback() {
    sourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    sourcesRef.current.clear();
    if (outCtxRef.current) playheadRef.current = outCtxRef.current.currentTime;
  }

  // Antwort-Audio (PCM 16-bit, meist 24 kHz) lückenlos hintereinander abspielen
  function playChunk(b64: string, mime: string) {
    const ctx = outCtxRef.current;
    const gain = outGainRef.current;
    if (!ctx || !gain) return;
    const rate = parseInt(/rate=(\d+)/.exec(mime)?.[1] ?? "24000", 10);
    const bytes = fromBase64(b64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buf = ctx.createBuffer(1, samples.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    const start = Math.max(ctx.currentTime + 0.03, playheadRef.current);
    src.start(start);
    playheadRef.current = start + buf.duration;
    lastAudioRef.current = Date.now();
    sourcesRef.current.add(src);
    setPhase("speaking");
    src.onended = () => {
      sourcesRef.current.delete(src);
      if (!sourcesRef.current.size && !endedRef.current) setPhase("listening");
    };
  }

  function addText(who: Line["who"], text: string) {
    if (!text) return;
    const role = who === "user" ? "user" : "assistant";
    const tr = transcriptRef.current;
    const isNew = curRef.current[who === "user" ? "user" : "bot"] === null;
    if (isNew || !tr.length || tr[tr.length - 1].role !== role) tr.push({ role, content: text });
    else tr[tr.length - 1].content += text;
    const key = who === "user" ? "user" : "bot";
    let id = curRef.current[key];
    if (id === null) {
      id = ++lineIdRef.current;
      curRef.current[key] = id;
      const newId = id;
      setLines((prev) => [...prev, { id: newId, who, text }].slice(-8));
    } else {
      const same = id;
      setLines((prev) => prev.map((l) => (l.id === same ? { ...l, text: l.text + text } : l)));
    }
  }

  // Werkzeuge des Assistenten → echte Einträge im CRM (über /api/agent)
  // Dieselbe Gesprächs-ID wie im Chat → dieselbe Kundenkarte
  const convRef = useRef<string>(conversationId);
  // Vollständige Mitschrift des Anrufs (für den Verlauf auf dem Gerät)
  const transcriptRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const asyncRef = useRef(false);
  const consentRef = useRef(false);
  const [links, setLinks] = useState<Resource[]>([]);
  const [office, setOffice] = useState<Office | null>(null);
  const botTurnRef = useRef("");
  const resumeRef = useRef(false);
  // Eintippen statt Sprechen (Namen, Nummern, Zeit) – vom Assistenten angefragt oder selbst geöffnet
  const [ask, setAsk] = useState<{ kind: "name" | "phone" | "time" | "text"; label: string } | null>(null);
  const [typed, setTyped] = useState("");

  function submitTyped(value: string, kind: "name" | "phone" | "time" | "text") {
    const v = (kind === "phone" ? formatPhone(value) : value).trim().slice(0, 200);
    if (!v) return;
    // Hinweis in der Sprache des Gesprächs, damit das Modell nicht ins Deutsche wechselt
    const W = {
      ru: { name: "имя", phone: "номер телефона", time: "удобное время для звонка", text: "сообщение", pre: "Собеседник ввёл на экране" },
      de: { name: "Name", phone: "Telefonnummer", time: "Wunschzeit für den Rückruf", text: "Nachricht", pre: "Die Person hat eingetippt" },
      en: { name: "name", phone: "phone number", time: "preferred callback time", text: "message", pre: "The caller typed on screen" },
    }[lang];
    try {
      sessionRef.current?.sendRealtimeInput({ text: `(${W.pre} – ${W[kind]}: ${v})` });
    } catch {}
    transcriptRef.current.push({ role: "user", content: v });
    // Eingetippter Name / Nummer: direkt in die Karte (der Server prüft die Einwilligung)
    if (kind === "name" || kind === "phone") {
      fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "card", conversationId: convRef.current, source: "call", args: { language: lang, [kind]: v } }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (res?.ok) {
            logAction(`${t.crmCardSaved}: ${v.slice(0, 40)}`, true);
            leadRef.current = true;
            setLeadSaved(true);
          }
        })
        .catch(() => {});
    }
    curRef.current.user = null;
    setLines((prev) => [...prev, { id: ++lineIdRef.current, who: "user" as Line["who"], text: `⌨ ${v}` }].slice(-8));
    setAsk(null);
    setTyped("");
  }
  const userSpokeRef = useRef(false);
  const [actions, setActions] = useState<{ id: number; text: string; ok: boolean }[]>([]);
  const actionId = useRef(0);

  function logAction(text: string, ok: boolean) {
    const id = ++actionId.current;
    setActions((prev) => [...prev, { id, text, ok }].slice(-3));
    setTimeout(() => setActions((prev) => prev.filter((x) => x.id !== id)), 6000);
  }

  async function handleToolCall(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]) {
    await Promise.all(
      calls.map(async (call) => {
        const args: Record<string, unknown> = { ...(call.args ?? {}) };
        if (call.name === "show_link") {
          const r = RESOURCES.find((x) => x.id === args.id);
          if (r) {
            setLinks((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
            const url = resourceUrl(r, lang);
            transcriptRef.current.push({ role: "assistant", content: `${r.title[lang]}${r.phone ? ` – ${r.phone}` : ""}\n${url}` });
            curRef.current.bot = null;
          }
          try {
            sessionRef.current?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: r ? { ok: true, shown: r.title.de } : { ok: false, error: "unknown_id" } }] });
          } catch {}
          return;
        }
        if (call.name === "show_location") {
          const o = locations.find((x) => officeId(x) === String(args.id));
          if (o) {
            setOffice(o);
            transcriptRef.current.push({ role: "assistant", content: `${o.label}: ${o.address} · ${o.phone}` });
            curRef.current.bot = null;
          }
          try {
            sessionRef.current?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: o ? { ok: true, shown: o.address } : { ok: false, error: "unknown_id" } }] });
          } catch {}
          return;
        }
        if (call.name === "ask_input") {
          const kind = (["name", "phone", "time", "text"].includes(String(args.kind)) ? args.kind : "text") as "name" | "phone" | "time" | "text";
          setTyped("");
          setAsk({ kind, label: String(args.label ?? "").slice(0, 120) });
          try {
            sessionRef.current?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { ok: true, shown: true } }] });
          } catch {}
          return;
        }
        if (call.name === "end_call") {
          try { sessionRef.current?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { ok: true } }] }); } catch {}
          endAfterGoodbye();
          return;
        }
        const action = call.name === "save_client_card" ? "card" : call.name === "add_task" ? "task" : call.name === "record_consent" ? "consent" : null;
        let result: Record<string, unknown> = { ok: false, error: "unknown_tool" };
        if (action) {
          try {
            const res = await fetch("/api/agent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action, conversationId: convRef.current, source: "call", args: { language: lang, ...args } }),
            });
            result = await res.json().catch(() => ({ ok: false, error: "bad_response" }));
          } catch {
            result = { ok: false, error: "network" };
          }
          const ok = result.ok === true;
          if (result.error === "consent_required") {
            // Kein Fehler für den Nutzer: das Modell fragt jetzt nach der Einwilligung
          } else if (action === "consent") {
            const granted = args.granted === true;
            consentRef.current = granted;
            logAction(ok ? (granted ? t.consentGiven : t.consentDenied) : t.crmNotSaved, ok);
          } else if (action === "card") {
            const what = [args.district, args.relation, args.care_level && `PG ${args.care_level}`, args.needs, args.name, args.phone]
              .filter(Boolean)
              .join(" · ");
            logAction(`${ok ? t.crmCardSaved : t.crmNotSaved}${what ? `: ${String(what).slice(0, 60)}` : ""}`, ok);
            if (ok) setAsk((a) => (a && ((a.kind === "phone" && args.phone) || (a.kind === "name" && args.name)) ? null : a));
            if (ok && (args.name || args.phone)) {
              leadRef.current = true;
              setLeadSaved(true);
            }
          } else {
            logAction(`${ok ? t.crmTaskSaved : t.crmNotSaved}: ${String(args.title ?? "").slice(0, 60)}`, ok);
            if (ok && args.due) setAsk((a) => (a?.kind === "time" ? null : a));
          }
        }
        const response: Record<string, unknown> = { id: call.id, name: call.name, response: result };
        // Asynchrone Werkzeuge: Ergebnis übergeben, sobald das Modell fertig gesprochen hat – dann spricht es weiter
        // (SILENT ließ das Modell verstummen, wenn sein Zug nur aus dem Werkzeugaufruf bestand)
        if (asyncRef.current) response.scheduling = "WHEN_IDLE";
        try { sessionRef.current?.sendToolResponse({ functionResponses: [response] }); } catch {}
      }),
    );
  }

  // Sagt der Assistent „… auf dem Bildschirm eintippen/auswählen“, öffnet sich das passende Feld –
  // auch wenn das Modell vergessen hat, ask_input aufzurufen.
  function autoOpenInput(text: string) {
    if (!/(на экране|auf dem bildschirm|on (the )?screen)/i.test(text)) return;
    const kind = /(телефон|номер|nummer|phone)/i.test(text)
      ? "phone"
      : /(врем|день|дату|zeit|termin|tag |time|day)/i.test(text)
        ? "time"
        : /(имя|фамили|зовут|обращаться|name|ansprechen)/i.test(text)
          ? "name"
          : null;
    if (!kind) return;
    setAsk((a) => a ?? { kind, label: "" });
  }

  function onMessage(msg: any) {
    if (msg?.toolCall?.functionCalls?.length) handleToolCall(msg.toolCall.functionCalls);
    const sc = msg?.serverContent;
    if (!sc) return;
    if (sc.interrupted) {
      // Person hat dazwischengesprochen → Assistent sofort still
      stopPlayback();
      curRef.current.bot = null;
      setPhase("listening");
    }
    if (sc.inputTranscription?.text) {
      curRef.current.bot = null;
      addText("user", sc.inputTranscription.text);
    }
    if (sc.outputTranscription?.text) {
      botTurnRef.current += sc.outputTranscription.text;
      autoOpenInput(botTurnRef.current);
      curRef.current.user = null;
      addText("bot", sc.outputTranscription.text);
    }
    for (const part of sc.modelTurn?.parts ?? []) {
      if (part?.inlineData?.data) playChunk(part.inlineData.data, part.inlineData.mimeType || "audio/pcm;rate=24000");
    }
    if (sc.turnComplete) {
      curRef.current = { user: null, bot: null };
      botTurnRef.current = "";
    }
  }

  function startMeter(mic: MediaStream) {
    try {
      const inCtx = inCtxRef.current!;
      const outCtx = outCtxRef.current!;
      const la = inCtx.createAnalyser();
      la.fftSize = 512;
      inCtx.createMediaStreamSource(mic).connect(la);
      const ra = outCtx.createAnalyser();
      ra.fftSize = 512;
      outGainRef.current!.connect(ra);
      const buf = new Uint8Array(512);
      const level = (a: AnalyserNode) => {
        a.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        return Math.sqrt(sum / buf.length);
      };
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const tick = () => {
        const micLv = level(la);
        if (micLv > 0.04) userSpokeRef.current = true;
        const lv = Math.max(level(ra), micLv * 0.8);
        if (ringRef.current && !reduce) ringRef.current.style.setProperty("--lv", Math.min(1, lv * 4).toFixed(3));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {}
  }

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    setPhase("connecting");

    (async () => {
      // 1) Mikrofon
      let mic: MediaStream;
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch {
        setError(t.callMicDenied);
        setPhase("error");
        return;
      }
      if (cancelled) { mic.getTracks().forEach((tr) => tr.stop()); return; }
      micRef.current = mic;

      try {
        // 2) Audio vorbereiten (innerhalb des Klicks, damit iOS/Safari Ton erlauben)
        const outCtx = new AudioContext({ sampleRate: 24000 });
        outCtxRef.current = outCtx;
        const gain = outCtx.createGain();
        gain.connect(outCtx.destination);
        outGainRef.current = gain;
        await outCtx.resume();

        const inCtx = new AudioContext();
        inCtxRef.current = inCtx;
        await addCaptureWorklet(inCtx);

        // 3) Einmal-Schlüssel vom eigenen Server
        const tokenRes = await fetch("/api/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lang, conversationId, history: history.slice(-20), lastAt }),
        });
        const token = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !token.token) throw new Error(token.error || "token");
        if (cancelled) return;

        // 4) Verbindung zu Gemini Live.
        // Laut Doku gelten Einmal-Schlüssel mit API-Version v1beta. Ältere SDK-Hinweise nennen v1alpha –
        // deshalb: wenn v1beta sofort abbricht, ein zweiter Versuch mit v1alpha (der Schlüssel erlaubt 2 Verbindungen).
        const { GoogleGenAI, Modality } = await import("@google/genai");
        const connect = (apiVersion: "v1beta" | "v1alpha") =>
          new Promise<any>((resolve, reject) => {
            // Bereit erst, wenn BEIDES da ist: die Sitzung (connect) und die erste Server-Nachricht (setupComplete).
            // Die Nachricht kann vor dem Ende von connect() eintreffen.
            let ready = false;
            let gotMessage = false;
            let session: any = null;
            const tryResolve = () => {
              if (!ready && gotMessage && session) {
                ready = true;
                sessionRef.current = session;
                resolve(session);
              }
            };
            const ai = new GoogleGenAI({ apiKey: token.token, httpOptions: { apiVersion } });
            ai.live
              .connect({
                model: token.model,
                config: { responseModalities: [Modality.AUDIO] },
                callbacks: {
                  onopen: () => {},
                  onmessage: (m: any) => {
                    gotMessage = true;
                    tryResolve();
                    onMessage(m);
                  },
                  onerror: (e: unknown) => console.warn("live error", apiVersion, e),
                  onclose: (e: { code?: number; reason?: string }) => {
                    if (!ready) return reject(new Error(`closed ${e?.code} ${e?.reason ?? ""}`));
                    if (!endedRef.current) {
                      console.warn("live closed", e?.code, e?.reason);
                      hangup();
                    }
                  },
                },
              })
              .then((s) => {
                session = s;
                tryResolve();
                // Die erste Antwort des Servers (setupComplete) bestätigt die Sitzung
                setTimeout(() => {
                  if (!ready) {
                    try { s.close(); } catch {}
                    reject(new Error("setup timeout"));
                  }
                }, 10000);
              }, reject);
          });

        let session: any;
        try {
          session = await connect("v1beta");
        } catch (e) {
          if (cancelled) return;
          console.warn("v1beta failed, retrying with v1alpha:", e);
          try { sessionRef.current?.close(); } catch {}
          session = await connect("v1alpha");
        }
        if (cancelled) { session.close(); return; }

        // 5) Mikrofon → Gemini
        const src = inCtx.createMediaStreamSource(mic);
        const node = new AudioWorkletNode(inCtx, "capture-16k");
        node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (endedRef.current) return;
          try {
            sessionRef.current?.sendRealtimeInput({ audio: { data: toBase64(e.data), mimeType: "audio/pcm;rate=16000" } });
          } catch {}
        };
        src.connect(node);
        startMeter(mic);

        // 6) Begrüßung nur, wenn die Person nicht schon selbst angefangen hat zu sprechen –
        //    sonst antwortet das Modell direkt auf sie (in ihrer Sprache, mit kurzem KI-Hinweis)
        userSpokeRef.current = false;
        setTimeout(() => {
          if (cancelled || endedRef.current || userSpokeRef.current) return;
          try {
            sessionRef.current?.sendRealtimeInput({
              text: resumeRef.current
                ? "(Anruf verbunden – Fortsetzung des eben unterbrochenen Gesprächs. Nicht neu begrüßen und nicht neu vorstellen: sag kurz, dass ihr weitermacht, und knüpfe an deine letzte offene Frage an.)"
                : "(Anruf verbunden, die Person hat noch nichts gesagt. Begrüße sie jetzt kurz, wie in den Anweisungen beschrieben.)",
            });
          } catch {}
        }, 700);

        setPhase("listening");
        asyncRef.current = token.asyncTools === true;
        resumeRef.current = token.resume === true;
        if (token.consent === true) consentRef.current = true;
        const max = Number(token.maxSeconds) || 300;
        const end = Date.now() + max * 1000;
        setLeft(max);
        timerRef.current = setInterval(() => {
          const s = Math.max(0, Math.round((end - Date.now()) / 1000));
          setLeft(s);
          if (s <= 0) hangup();
        }, 1000);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError(t.callFailed);
          setPhase("error");
          hangup();
        }
      }
    })();

    return () => {
      cancelled = true;
      hangup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function close() {
    hangup();
    onClose({
      leadSaved: leadRef.current,
      transcript: transcriptRef.current.map((m) => ({ ...m, content: m.content.replace(/\s+/g, " ").trim() })).filter((m) => m.content),
    });
  }

  const status =
    phase === "connecting" ? t.callConnecting
    : phase === "speaking" ? t.callSpeaking
    : phase === "listening" ? t.callListening
    : phase === "ended" ? t.callEnded
    : error;

  return (
    <div className="call" role="dialog" aria-modal="true" aria-label={t.callTitle}>
      <div className="call-head">
        <span className="call-company">{companyName}</span>
        {left !== null && phase !== "ended" && phase !== "error" && <span className="call-timer">{t.callTimeLeft(left)}</span>}
      </div>

      <div className={`call-orb is-${phase}`} ref={ringRef} aria-hidden="true">
        <span className="ring r3" />
        <span className="ring r2" />
        <span className="ring r1" />
        <span className="core" />
      </div>

      <p className="call-status" aria-live="polite">{status}</p>
      {leadSaved && <p className="call-badge">✓ {t.callLeadSaved}</p>}
      <div className="call-actions-log" aria-live="polite">
        {actions.map((a) => (
          <p key={a.id} className={`crm-chip${a.ok ? "" : " bad"}`}>{a.ok ? "✓" : "!"} {a.text}</p>
        ))}
      </div>

      {links.length > 0 && (
        <ul className="call-links">
          {links.map((r) => (
            <li key={r.id}>
              <a href={resourceUrl(r, lang)} target="_blank" rel="noopener noreferrer">
                <span aria-hidden="true">🔗</span> {r.title[lang]}
              </a>
              {resourceFile(r, lang) && (
                <a className="call-link-phone" href={resourceFile(r, lang)} target="_blank" rel="noopener noreferrer" download>PDF ↓</a>
              )}
              {r.phone && <a className="call-link-phone" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a>}
            </li>
          ))}
        </ul>
      )}
      {office && (
        <div className="call-map">
          <iframe title={office.label} src={mapEmbed(office)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          <div className="call-map-info">
            <strong>{companyName.split(" ")[0]} {office.label}</strong>
            <span>{office.address}</span>
            <div className="call-map-actions">
              <a href={mapRoute(office)} target="_blank" rel="noopener noreferrer">{t.route}</a>
              <a href={`tel:${office.phone.replace(/[^\d+]/g, "")}`}>{office.phone}</a>
              <button type="button" className="linklike light" onClick={() => setOffice(null)}>{t.close}</button>
            </div>
          </div>
        </div>
      )}

      {ask && phase !== "ended" && phase !== "error" && (
        <form
          className="call-type"
          onSubmit={(e) => {
            e.preventDefault();
            submitTyped(typed, ask.kind);
          }}
        >
          <p>{ask.label || (ask.kind === "phone" ? t.askPhone : ask.kind === "name" ? t.askName : ask.kind === "time" ? t.askTime : t.typeIt)}</p>
          {ask.kind === "time" ? (
            <TimePicker compact lang={lang} onPick={(v) => submitTyped(v, "time")} />
          ) : (
            <div className="call-type-row">
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(ask.kind === "phone" ? formatPhone(e.target.value) : e.target.value)}
                type={ask.kind === "phone" ? "tel" : "text"}
                inputMode={ask.kind === "phone" ? "tel" : "text"}
                autoComplete={ask.kind === "name" ? "name" : ask.kind === "phone" ? "tel" : "off"}
                autoCapitalize={ask.kind === "name" ? "words" : "off"}
                enterKeyHint="send"
                placeholder={ask.kind === "phone" ? "0151 2345 6789" : ask.kind === "name" ? t.leadName : ""}
                maxLength={ask.kind === "phone" ? 22 : 200}
                aria-label={ask.label || t.typeIt}
              />
              <button className="btn btn-light" disabled={ask.kind === "phone" ? !phoneOk(typed) : !typed.trim()}>{t.typeSend}</button>
            </div>
          )}
          <button type="button" className="linklike light" onClick={() => setAsk(null)}>{t.close}</button>
        </form>
      )}
      {!ask && phase !== "ended" && phase !== "error" && phase !== "connecting" && (
        <div className="call-quick" role="group" aria-label={t.typeIt}>
          <button type="button" onClick={() => setAsk({ kind: "name", label: "" })}>✎ {t.qName}</button>
          <button type="button" onClick={() => setAsk({ kind: "phone", label: "" })}>☎ {t.qPhone}</button>
          <button type="button" onClick={() => setAsk({ kind: "time", label: "" })}>🕑 {t.qTime}</button>
          <button type="button" onClick={() => setAsk({ kind: "text", label: "" })}>⌨</button>
        </div>
      )}
      <div className="call-actions">
        {phase === "ended" || phase === "error" ? (
          <>
            <button className="btn btn-light" onClick={close}>{t.close}</button>
            <a className="btn btn-ghost-light" href={`tel:${phoneHref}`}>{t.callUs}: {phone}</a>
          </>
        ) : (
          <>
          <button className="hangup" onClick={close} aria-label={t.callEnd}>
            <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
            <span>{t.callEnd}</span>
          </button>
          </>
        )}
      </div>
    </div>
  );
}
