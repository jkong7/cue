declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: unknown): void;

class PcmProcessor extends AudioWorkletProcessor {
  private buf = new Int16Array(1600);
  private n = 0;

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = v * 32767;
      if (this.n === this.buf.length) {
        let sum = 0;
        for (let j = 0; j < this.buf.length; j++) sum += (this.buf[j] / 32768) ** 2;
        this.port.postMessage({ pcm: this.buf.buffer.slice(0), level: Math.sqrt(sum / this.buf.length) });
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm", PcmProcessor);
