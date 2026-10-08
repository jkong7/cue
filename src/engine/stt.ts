import { EventEmitter } from "node:events";
import type { Speaker, SpeechEvent } from "./types.ts";

export interface SttStream extends EventEmitter<{ speech: [SpeechEvent]; error: [string]; open: []; close: [] }> {
  write(pcm: Buffer): void;
  close(): void;
}

interface DgWord { start: number; end: number }
interface DgResults {
  type: "Results";
  is_final: boolean;
  speech_final: boolean;
  start: number;
  duration: number;
  channel: { alternatives: { transcript: string; words: DgWord[] }[] };
}

export class TurnAssembler {
  private finals: string[] = [];
  private turnStart = -1;
  private speaker: Speaker;
  private t0: number;

  constructor(speaker: Speaker, t0: number) {
    this.speaker = speaker;
    this.t0 = t0;
  }

  push(raw: string): SpeechEvent[] {
    let msg: DgResults | { type: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return [];
    }
    if (msg.type === "UtteranceEnd") return this.flush();
    if (msg.type !== "Results") return [];
    const r = msg as DgResults;
    const text = r.channel.alternatives[0]?.transcript?.trim() ?? "";
    const startMs = this.t0 + r.start * 1000;
    const endMs = this.t0 + (r.start + r.duration) * 1000;
    if (text && this.turnStart < 0) this.turnStart = startMs;
    if (r.is_final) {
      if (text) this.finals.push(text);
      if (r.speech_final) return this.flush(endMs);
      if (this.finals.length) return [{ speaker: this.speaker, text: this.finals.join(" "), final: false, start: this.turnStart, end: endMs }];
      return [];
    }
    if (text) return [{ speaker: this.speaker, text: [...this.finals, text].join(" "), final: false, start: this.turnStart, end: endMs }];
    return [];
  }

  flush(end = Date.now()): SpeechEvent[] {
    if (!this.finals.length) return [];
    const ev: SpeechEvent = { speaker: this.speaker, text: this.finals.join(" "), final: true, start: this.turnStart, end };
    this.finals = [];
    this.turnStart = -1;
    return [ev];
  }
}

export class DeepgramStream extends EventEmitter<{ speech: [SpeechEvent]; error: [string]; open: []; close: [] }> implements SttStream {
  private ws: WebSocket;
  private turns: TurnAssembler;
  private queue: Uint8Array<ArrayBuffer>[] = [];
  private keepAlive: ReturnType<typeof setInterval>;
  private speaker: Speaker;

  constructor(opts: { apiKey: string; speaker: Speaker; t0: number; keyterms?: string[] }) {
    super();
    this.speaker = opts.speaker;
    this.turns = new TurnAssembler(opts.speaker, opts.t0);
    const params = new URLSearchParams({
      model: "nova-3",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      endpointing: "300",
      utterance_end_ms: "1000",
      vad_events: "true",
    });
    for (const k of (opts.keyterms ?? []).slice(0, 50)) params.append("keyterm", k);
    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["token", opts.apiKey]);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      for (const b of this.queue) this.ws.send(b);
      this.queue = [];
      this.emit("open");
    };
    this.ws.onerror = () => this.emit("error", `Deepgram connection failed for ${this.speaker}`);
    this.ws.onclose = (e) => {
      clearInterval(this.keepAlive);
      if (e.code !== 1000 && e.code !== 1005) this.emit("error", `Deepgram closed (${e.code}${e.reason ? `: ${e.reason}` : ""})`);
      this.emit("close");
    };
    this.ws.onmessage = (e) => this.onMessage(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer));
    this.keepAlive = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "KeepAlive" }));
    }, 8000);
  }

  private onMessage(raw: string) {
    for (const ev of this.turns.push(raw)) this.emit("speech", ev);
  }

  write(pcm: Buffer) {
    const bytes = new Uint8Array(pcm);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(bytes);
    else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(bytes);
  }

  close() {
    for (const ev of this.turns.flush()) this.emit("speech", ev);
    clearInterval(this.keepAlive);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "CloseStream" }));
      setTimeout(() => this.ws.close(1000), 1500);
    }
  }
}

export interface ScriptLine {
  speaker: Speaker;
  text: string;
  pause?: number;
}

export class ScriptPlayer extends EventEmitter<{ speech: [SpeechEvent]; done: [] }> {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private lines: ScriptLine[];
  private speed: number;

  constructor(lines: ScriptLine[], speed = 1) {
    super();
    this.lines = lines;
    this.speed = speed;
  }

  start(now = Date.now()) {
    let t = 600;
    for (const line of this.lines) {
      t += (line.pause ?? 900) / this.speed;
      const words = line.text.split(" ");
      const perWord = 260 / this.speed;
      const start = t;
      words.forEach((_, i) => {
        const at = start + i * perWord;
        this.timers.push(setTimeout(() => this.emit("speech", { speaker: line.speaker, text: words.slice(0, i + 1).join(" "), final: false, start: now + start, end: now + at }), at));
      });
      t = start + words.length * perWord;
      const end = t;
      this.timers.push(setTimeout(() => this.emit("speech", { speaker: line.speaker, text: line.text, final: true, start: now + start, end: now + end }), end + 120 / this.speed));
      t += 200 / this.speed;
    }
    this.timers.push(setTimeout(() => this.emit("done"), t + 500));
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
