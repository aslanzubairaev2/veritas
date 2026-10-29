"use client";

import { useEffect, useRef, useState } from "react";
import { T, type Lang } from "@/lib/i18n";
import { addCaptureWorklet, toBase64 } from "@/lib/pcm";

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
  onClose,
}: {
  lang: Lang;
  companyName: string;
  phone: string;
  phoneHref: string;
  onClose: (summary?: { leadSaved: boolean }) => void;
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
    sourcesRef.current.add(src);
    setPhase("speaking");
    src.onended = () => {
      sourcesRef.current.delete(src);
      if (!sourcesRef.current.size && !endedRef.current) setPhase("listening");
    };
  }

  function addText(who: Line["who"], text: string) {
    if (!text) return;
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

  async function handleToolCall(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]) {
    const responses = [];
    for (const call of calls) {
      let result: Record<string, unknown> = { ok: false, error: "unknown_tool" };
      if (call.name === "save_callback_request") {
        try {
          const args = call.args ?? {};
          const res = await fetch("/api/lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...args, source: "call", language: (args.language as string) || lang }),
          });
          const data = await res.json().catch(() => ({}));
          result = res.ok ? { ok: true } : { ok: false, error: data?.error || "save_failed" };
          if (res.ok) {
            leadRef.current = true;
            setLeadSaved(true);
          }
        } catch {
          result = { ok: false, error: "network" };
        }
      }
      responses.push({ id: call.id, name: call.name, response: result });
    }
    try { sessionRef.current?.sendToolResponse({ functionResponses: responses }); } catch {}
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
      curRef.current.user = null;
      addText("bot", sc.outputTranscription.text);
    }
    for (const part of sc.modelTurn?.parts ?? []) {
      if (part?.inlineData?.data) playChunk(part.inlineData.data, part.inlineData.mimeType || "audio/pcm;rate=24000");
    }
    if (sc.turnComplete) curRef.current = { user: null, bot: null };
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
        const lv = Math.max(level(ra), level(la) * 0.8);
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
          body: JSON.stringify({ lang }),
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

        // 6) Assistent soll zuerst begrüßen
        session.sendRealtimeInput({
          text:
            lang === "ru" ? "(Звонящий подключился. Поздоровайся.)"
            : lang === "en" ? "(The caller is connected. Please greet them.)"
            : "(Der Anrufer ist verbunden. Bitte begrüße ihn.)",
        });

        setPhase("listening");
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
    onClose({ leadSaved: leadRef.current });
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

      <div className="call-lines" aria-live="polite">
        {lines.slice(-4).map((l) => (
          <p key={l.id} className={`cl ${l.who}`}>{l.text}</p>
        ))}
      </div>

      <div className="call-actions">
        {phase === "ended" || phase === "error" ? (
          <>
            <button className="btn btn-light" onClick={close}>{t.close}</button>
            <a className="btn btn-ghost-light" href={`tel:${phoneHref}`}>{t.callUs}: {phone}</a>
          </>
        ) : (
          <button className="hangup" onClick={close} aria-label={t.callEnd}>
            <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
            <span>{t.callEnd}</span>
          </button>
        )}
      </div>
      <p className="call-note">{t.aiNote}</p>
    </div>
  );
}
