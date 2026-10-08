import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Brain, Card, Playbook, PracticeGrade, SpeechEvent, Utterance } from "./types.ts";
import { GRADE_SCHEMA, PRACTICE_ASK_SYSTEM, PRACTICE_GRADE_SYSTEM, buildContext, formatTranscript } from "./prompts.ts";
import { words } from "./coach.ts";

export interface PracticeEvents {
  utterance: [Utterance];
  card: [Card];
  "card:delta": [{ id: string; text: string }];
  "card:done": [Card];
  turn: ["asking" | "listening" | "grading"];
  error: [string];
}

export class PracticeSession extends EventEmitter<PracticeEvents> {
  readonly id = randomUUID();
  readonly startedAt = Date.now();
  utterances: Utterance[] = [];
  cards: Card[] = [];
  grades: PracticeGrade[] = [];
  private brain: Brain;
  private playbook: Playbook | null;
  private context: string;
  private answer: string[] = [];
  private answerStart = 0;
  private silence: ReturnType<typeof setTimeout> | null = null;
  private silenceMs: number;
  private state: "asking" | "listening" | "grading" = "asking";
  private question = "";

  constructor(opts: { brain: Brain; playbook: Playbook | null; silenceMs?: number }) {
    super();
    this.brain = opts.brain;
    this.playbook = opts.playbook;
    this.silenceMs = opts.silenceMs ?? 2500;
    this.context = buildContext(opts.playbook, [], () => []);
  }

  private card(kind: Card["kind"], title: string, body = "", done = false): Card {
    const c: Card = { id: randomUUID(), kind, title, body, at: Date.now(), done };
    this.cards.push(c);
    this.emit("card", { ...c });
    return c;
  }

  private setState(s: "asking" | "listening" | "grading") {
    this.state = s;
    this.emit("turn", s);
  }

  async ask(): Promise<void> {
    this.setState("asking");
    const c = this.card("practice", "They ask");
    try {
      const text = await this.brain.stream({
        task: "practice-ask",
        system: PRACTICE_ASK_SYSTEM,
        context: this.context,
        prompt: `<kind>${this.playbook?.kind ?? "default"}</kind>\n<transcript>\n${formatTranscript(this.utterances, 8000)}\n</transcript>\n<request>Ask your next question.</request>`,
        maxTokens: 1500,
      }, (t) => {
        c.body += t;
        this.emit("card:delta", { id: c.id, text: t });
      });
      c.done = true;
      this.emit("card:done", { ...c });
      this.question = text;
      const u: Utterance = { id: randomUUID(), speaker: "them", text, start: Date.now(), end: Date.now(), final: true };
      this.utterances.push(u);
      this.emit("utterance", u);
      this.answer = [];
      this.setState("listening");
    } catch (e) {
      this.emit("error", e instanceof Error ? e.message : String(e));
    }
  }

  ingest(ev: SpeechEvent) {
    if (ev.speaker !== "me" || this.state !== "listening") return;
    if (this.silence) clearTimeout(this.silence);
    if (!this.answer.length) this.answerStart = ev.start;
    this.emit("utterance", { id: "practice-live", speaker: "me", text: [...this.answer, ev.text].join(" "), start: this.answerStart, end: ev.end, final: false });
    if (ev.final) {
      this.answer.push(ev.text);
      this.silence = setTimeout(() => void this.submit(), this.silenceMs);
    }
  }

  async answerText(text: string): Promise<PracticeGrade | null> {
    if (this.state !== "listening") return null;
    this.answer.push(text);
    return this.submit();
  }

  async submit(): Promise<PracticeGrade | null> {
    if (this.silence) clearTimeout(this.silence);
    this.silence = null;
    const answer = this.answer.join(" ").trim();
    if (this.state !== "listening" || words(answer) < 3) return null;
    const u: Utterance = { id: randomUUID(), speaker: "me", text: answer, start: this.answerStart, end: Date.now(), final: true };
    this.utterances.push(u);
    this.emit("utterance", u);
    this.answer = [];
    this.setState("grading");
    try {
      const grade = await this.brain.json<PracticeGrade>({
        task: "practice-grade",
        system: PRACTICE_GRADE_SYSTEM,
        context: this.context,
        prompt: `<question>${this.question}</question>\n<answer>${answer}</answer>`,
        maxTokens: 3000,
      }, GRADE_SCHEMA);
      this.grades.push(grade);
      const body = [
        ...grade.worked.map((w) => `+ ${w}`),
        ...grade.improve.map((w) => `- ${w}`),
        `\n**Stronger:** ${grade.stronger}`,
      ].join("\n");
      const c = this.card("coach", `Score ${grade.score}/5`, body, true);
      this.emit("card:done", { ...c });
      await this.ask();
      return grade;
    } catch (e) {
      this.emit("error", e instanceof Error ? e.message : String(e));
      this.setState("listening");
      return null;
    }
  }

  average(): number {
    return this.grades.length ? this.grades.reduce((n, g) => n + g.score, 0) / this.grades.length : 0;
  }

  dispose() {
    if (this.silence) clearTimeout(this.silence);
  }
}
