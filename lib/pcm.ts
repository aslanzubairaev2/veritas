// Mikrofon → 16 kHz, 16-bit PCM (Format für die Gemini Live API), als AudioWorklet im Browser.
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / 16000; this.pos = 0; this.buf = [];
    this.chunk = (options && options.processorOptions && options.processorOptions.chunk) || 640;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (; this.pos < ch.length; this.pos += this.ratio) {
        const s = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]));
        this.buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
      this.pos -= ch.length;
      if (this.buf.length >= this.chunk) {
        this.port.postMessage(Int16Array.from(this.buf).buffer, []);
        this.buf = [];
      }
    }
    return true;
  }
}
registerProcessor("capture-16k", Capture);
`;

export async function addCaptureWorklet(ctx: AudioContext) {
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Lautstärke (RMS 0…1) eines 16-bit-PCM-Blocks */
export function rms(buf: ArrayBuffer): number {
  const a = new Int16Array(buf);
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] / 0x8000;
    sum += v * v;
  }
  return a.length ? Math.sqrt(sum / a.length) : 0;
}
