import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";

export class SystemAudio extends EventEmitter<{ pcm: [Buffer]; error: [string]; ready: []; level: [number] }> {
  private proc: ChildProcess | null = null;
  private bin: string;
  private pending = Buffer.alloc(0);

  constructor(bin: string) {
    super();
    this.bin = bin;
  }

  available() {
    return process.platform === "darwin" && existsSync(this.bin);
  }

  start() {
    if (this.proc) return;
    if (!this.available()) {
      this.emit("error", "System audio helper missing. Run npm run build on macOS to compile it.");
      return;
    }
    const proc = spawn(this.bin, [], { stdio: ["ignore", "pipe", "pipe"] });
    this.proc = proc;
    proc.stdout!.on("data", (chunk: Buffer) => {
      this.pending = Buffer.concat([this.pending, chunk]);
      const size = 3200;
      while (this.pending.length >= size) {
        const frame = this.pending.subarray(0, size);
        this.pending = this.pending.subarray(size);
        this.emit("pcm", Buffer.from(frame));
        this.emit("level", rms(frame));
      }
    });
    proc.stderr!.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg === "ready") this.emit("ready");
      else if (msg) this.emit("error", `System audio: ${msg}. Grant Screen & System Audio Recording to Cue (or your terminal) in System Settings > Privacy & Security.`);
    });
    proc.on("exit", () => {
      this.proc = null;
    });
  }

  stop() {
    this.proc?.kill("SIGTERM");
    this.proc = null;
    this.pending = Buffer.alloc(0);
  }
}

export function rms(pcm: Buffer): number {
  let sum = 0;
  const n = Math.floor(pcm.length / 2);
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return n ? Math.sqrt(sum / n) : 0;
}
