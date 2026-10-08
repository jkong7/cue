import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Brain, Card, CardKind, CoachStats, Debrief, MemoryView, Person, Playbook, SpeechEvent, Utterance } from "./types.ts";
import { coachStats, nudge, words } from "./coach.ts";
import { lastQuestion, overlap, questionScore } from "./detect.ts";
import { Recaller } from "./recall.ts";
import { ASSIST_SYSTEM, DEBRIEF_SCHEMA, DEBRIEF_SYSTEM, INSIGHTS_SCHEMA, INSIGHTS_SYSTEM, buildContext, formatTranscript } from "./prompts.ts";

export interface LiveOptions {
  brain: Brain;
  memory: MemoryView;
  playbook: Playbook | null;
  attendees: Person[];
  autoSuggest?: boolean;
  insights?: boolean;
  coach?: boolean;
  insightsEveryMs?: number;
  suggestDebounceMs?: number;
  now?: () => number;
}

export interface LiveEvents {
  utterance: [Utterance];
  drop: [string];
  card: [Card];
  "card:delta": [{ id: string; text: string }];
  "card:done": [Card];
  stats: [CoachStats];
  error: [string];
}

const isAbort = (e: unknown) => e instanceof Error && (e.name === "AbortError" || e.name === "APIUserAbortError");

export class LiveSession extends EventEmitter<LiveEvents> {
  readonly id = randomUUID();
  readonly startedAt: number;
  utterances: Utterance[] = [];
  cards: Card[] = [];
  private partial: Record<string, { u: Utterance; base: string; merged: boolean } | undefined> = {};
  private o: Required<Omit<LiveOptions, "playbook">> & { playbook: Playbook | null };
  private recaller: Recaller;
  private inflight: AbortController | null = null;
  private suggestTimer: ReturnType<typeof setTimeout> | null = null;
  private insightsTimer: ReturnType<typeof setInterval> | null = null;
  private insightsBusy = false;
  private wordsSinceInsights = 0;
  private lastNudge: Record<string, number> = {};
  private lastNudgeAt = 0;
  private lastSuggestedFor = "";
  private context: string;

  constructor(opts: LiveOptions) {
    super();
    this.o = {
      autoSuggest: true,
      insights: true,
      coach: true,
      insightsEveryMs: 20000,
      suggestDebounceMs: 900,
      now: () => Date.now(),
      ...opts,
    };
    this.startedAt = this.o.now();
    const attendeeIds = new Set(opts.attendees.map((p) => p.id));
    this.recaller = new Recaller(() => this.o.memory.people(), (id) => this.o.memory.factsFor(id), attendeeIds);
    this.context = buildContext(opts.playbook, opts.attendees, (id) => this.o.memory.factsFor(id));
    if (this.o.insights) this.insightsTimer = setInterval(() => void this.runInsights(), this.o.insightsEveryMs);
  }

  get kind() {
    return this.o.playbook?.kind ?? "meeting";
  }

  ingest(ev: SpeechEvent) {
    const text = ev.text.trim();
    if (!text) return;
    let p = this.partial[ev.speaker];
    if (!p) {
      const prev = this.utterances[this.utterances.length - 1];
      p = prev && prev.speaker === ev.speaker && ev.start - prev.end < 1500
        ? { u: prev, base: prev.text, merged: true }
        : { u: { id: randomUUID(), speaker: ev.speaker, text, start: ev.start, end: ev.end, final: false }, base: "", merged: false };
      this.partial[ev.speaker] = p;
    }
    p.u.text = p.base ? `${p.base} ${text}` : text;
    p.u.end = ev.end;
    if (!p.merged) p.u.final = ev.final;
    if (ev.final) {
      this.partial[ev.speaker] = undefined;
      if (ev.speaker === "me" && this.isEcho(text, ev.end)) {
        if (p.merged) p.u.text = p.base;
        else this.emit("drop", p.u.id);
        if (p.merged) this.emit("utterance", { ...p.u });
        return;
      }
      if (!p.merged) this.utterances.push(p.u);
    }
    this.emit("utterance", { ...p.u });
    if (ev.final) this.onFinal(p.u, words(text));
    else if (ev.speaker === "me" && this.suggestTimer && words(text) > 4) this.clearSuggestTimer();
  }

  private isEcho(text: string, end: number): boolean {
    const recent = this.utterances.filter((u) => u.speaker === "them" && end - u.end < 8000).slice(-3);
    const them = this.partial.them?.u;
    return [...recent, ...(them ? [them] : [])].some((u) => overlap(text, u.text) >= 0.7);
  }

  private pendingPartials(): Utterance[] {
    return Object.values(this.partial).flatMap((p) => (p && !p.merged ? [p.u] : []));
  }

  private onFinal(u: Utterance, added: number) {
    for (const hit of this.recaller.check(u.text)) {
      const body = [hit.person.notes, ...hit.facts.map((f) => f.text)].filter(Boolean).map((t) => `- ${t}`).join("\n");
      this.addCard("recall", `${hit.person.name}${hit.person.org ? ` · ${hit.person.org}` : ""}`, body, true, u.text);
    }
    if (u.speaker === "them") {
      this.wordsSinceInsights += added;
      if (this.o.autoSuggest && questionScore(u.text) >= 0.55) this.scheduleSuggest(u);
    }
    if (this.o.coach) this.updateCoach();
  }

  private scheduleSuggest(u: Utterance) {
    this.clearSuggestTimer();
    this.suggestTimer = setTimeout(() => {
      this.suggestTimer = null;
      const q = lastQuestion(u.text);
      if (q === this.lastSuggestedFor) return;
      this.lastSuggestedFor = q;
      void this.assist("suggest", { question: q });
    }, this.o.suggestDebounceMs);
  }

  private clearSuggestTimer() {
    if (this.suggestTimer) clearTimeout(this.suggestTimer);
    this.suggestTimer = null;
  }

  private updateCoach() {
    const stats = coachStats(this.utterances, this.o.now());
    this.emit("stats", stats);
    const n = nudge(stats, this.kind);
    const t = this.o.now();
    if (n && t - (this.lastNudge[n.key] ?? 0) > 120000 && t - this.lastNudgeAt > 45000) {
      this.lastNudge[n.key] = t;
      this.lastNudgeAt = t;
      this.addCard("coach", "Coach", n.text, true);
    }
  }

  addCard(kind: CardKind, title: string, body: string, done: boolean, trigger?: string): Card {
    const card: Card = { id: randomUUID(), kind, title, body, at: this.o.now(), done, trigger };
    this.cards.push(card);
    this.emit("card", { ...card });
    if (done) this.emit("card:done", { ...card });
    return card;
  }

  async assist(mode: "answer" | "suggest", opts: { question?: string; image?: string } = {}): Promise<Card | null> {
    this.inflight?.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    const related = opts.question ? this.o.memory.search(opts.question, 4) : [];
    const title = mode === "answer" ? (opts.image ? "On your screen" : "Answer") : "Say this";
    const card = this.addCard(mode === "answer" ? "answer" : "suggest", title, "", false, opts.question);
    const request = mode === "answer"
      ? opts.image ? "Look at my screen and the conversation. Answer what I most likely need right now." : "Answer the question for me."
      : "They just asked me this. Give me what to say.";
    const prompt = [
      `<transcript>\n${formatTranscript(this.utterances.concat(this.pendingPartials()))}\n</transcript>`,
      opts.question ? `<question>${opts.question}</question>` : "",
      related.length ? `<related_memory>\n${related.map((r) => `- ${r.text} (${r.source})`).join("\n")}\n</related_memory>` : "",
      `<request>${request}</request>`,
    ].filter(Boolean).join("\n\n");
    try {
      await this.o.brain.stream({ task: "assist", system: ASSIST_SYSTEM, context: this.context, prompt, image: opts.image, maxTokens: 4000 }, (text) => {
        card.body += text;
        this.emit("card:delta", { id: card.id, text });
      }, ctrl.signal);
      card.done = true;
      this.emit("card:done", { ...card });
      return card;
    } catch (e) {
      card.done = true;
      if (isAbort(e)) {
        card.body ||= "(replaced by a newer answer)";
      } else {
        card.body ||= `Couldn't get an answer: ${e instanceof Error ? e.message : String(e)}`;
        this.emit("error", card.body);
      }
      this.emit("card:done", { ...card });
      return null;
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
    }
  }

  async runInsights(force = false): Promise<Card[]> {
    if (this.insightsBusy || (!force && this.wordsSinceInsights < 25)) return [];
    this.insightsBusy = true;
    this.wordsSinceInsights = 0;
    const shown = this.cards.filter((c) => c.kind === "define" || c.kind === "fact" || c.kind === "tip").map((c) => c.title);
    try {
      const out = await this.o.brain.json<{ cards: { kind: "define" | "fact" | "tip"; title: string; body: string }[] }>({
        task: "insights",
        system: INSIGHTS_SYSTEM,
        context: this.context,
        prompt: `<transcript>\n${formatTranscript(this.utterances, 5000)}\n</transcript>\n\n<already_shown>\n${shown.join("\n")}\n</already_shown>`,
        maxTokens: 2000,
      }, INSIGHTS_SCHEMA);
      const seen = new Set(shown.map((s) => s.toLowerCase()));
      return out.cards.filter((c) => !seen.has(c.title.toLowerCase())).slice(0, 3).map((c) => this.addCard(c.kind, c.title, c.body, true));
    } catch (e) {
      this.emit("error", `Insights failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    } finally {
      this.insightsBusy = false;
    }
  }

  stats(): CoachStats {
    return coachStats(this.utterances, this.o.now());
  }

  async finish(): Promise<Debrief | null> {
    this.dispose();
    for (const u of this.pendingPartials()) this.utterances.push({ ...u, final: true });
    this.partial = {};
    if (this.utterances.length < 2) return null;
    const stats = this.stats();
    return this.o.brain.json<Debrief>({
      task: "debrief",
      system: DEBRIEF_SYSTEM,
      context: this.context,
      prompt: `<transcript>\n${formatTranscript(this.utterances, 400000)}\n</transcript>\n\n<stats>talk ratio ${Math.round(stats.talkRatio * 100)}% me, ${stats.wpm} wpm, ${stats.fillers} filler words, longest monologue ${stats.longestMonologue}s, ${stats.questionsAsked} questions asked by me</stats>`,
      maxTokens: 16000,
    }, DEBRIEF_SCHEMA);
  }

  dispose() {
    this.inflight?.abort();
    this.clearSuggestTimer();
    if (this.insightsTimer) clearInterval(this.insightsTimer);
    this.insightsTimer = null;
  }
}
