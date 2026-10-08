import { test } from "node:test";
import assert from "node:assert/strict";
import { isQuestion, lastQuestion, overlap, questionScore } from "../src/engine/detect.ts";
import { coachStats, countFillers, nudge } from "../src/engine/coach.ts";
import { redact } from "../src/engine/redact.ts";
import { mentions, Recaller } from "../src/engine/recall.ts";
import { Store, ftsQuery } from "../src/engine/store.ts";
import { LiveSession } from "../src/engine/session.ts";
import { PracticeSession } from "../src/engine/practice.ts";
import { RehearsalBrain } from "../src/engine/rehearsal.ts";
import { ScriptPlayer } from "../src/engine/stt.ts";
import { SCRIPTS } from "../src/engine/scripts.ts";
import { buildContext, formatTranscript } from "../src/engine/prompts.ts";
import type { Brain, BrainRequest, Utterance } from "../src/engine/types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const u = (speaker: "me" | "them", text: string, start: number, end: number): Utterance => ({ id: `${start}`, speaker, text, start, end, final: true });

test("question detection", () => {
  assert.ok(isQuestion("Can you walk me through your background?"));
  assert.ok(isQuestion("Tell me about a time you disagreed with your manager"));
  assert.ok(isQuestion("how would you design a rate limiter for a public API"));
  assert.ok(!isQuestion("Yeah that makes sense."));
  assert.ok(!isQuestion("We moved billing to Kafka last quarter."));
  assert.ok(!isQuestion("Okay?"));
  assert.ok(questionScore("It's fine, right?") < 0.55);
  assert.equal(lastQuestion("We moved to Kafka. Anyway, what made it hard?"), "Anyway, what made it hard?");
});

test("overlap catches speaker bleed", () => {
  assert.ok(overlap("how would you design a rate limiter", "Okay, and how would you design a rate limiter for a public API?") > 0.7);
  assert.ok(overlap("I built the streaming pipeline at Abridge", "What did you build?") < 0.5);
});

test("coach stats and nudges", () => {
  const utts = [
    u("them", "Tell me about yourself please", 0, 2000),
    u("me", "Um so basically I, you know, build things. ".repeat(30), 2500, 62500),
    u("them", "ok", 63000, 63500),
  ];
  const s = coachStats(utts, 64000);
  assert.ok(s.talkRatio > 0.9);
  assert.ok(s.fillers >= 60);
  assert.equal(countFillers("um uh you know basically"), 4);
  const n = nudge({ ...s, myWords: 300, theirWords: 6 }, "interview");
  assert.ok(n);
  assert.equal(nudge({ ...s, talkRatio: 0.3, fillerRate: 0, currentMonologue: 0, wpm: 120 }, "interview"), null);
});

test("redaction", () => {
  assert.equal(redact("card 4242 4242 4242 4242 ok"), "card [card number] ok");
  assert.equal(redact("ssn 123-45-6789"), "ssn [ssn]");
  assert.match(redact("my password is hunter2"), /\[redacted\]/);
  assert.match(redact("key sk-ant-api03-abcdefghijklmnop"), /\[secret key\]/);
});

test("recall finds people once", () => {
  const people = [{ id: "1", name: "Priya Raman", org: "Lumen", role: "", notes: "Runs platform", lastSeen: 0 }];
  assert.equal(mentions("I talked to priya yesterday", people).length, 1);
  assert.equal(mentions("Lumen is hiring", people).length, 1);
  assert.equal(mentions("nothing here", people).length, 0);
  const r = new Recaller(() => people, () => []);
  assert.equal(r.check("Priya said hi").length, 1);
  assert.equal(r.check("Priya again").length, 0);
});

test("store: playbooks, people, facts, sessions, search", () => {
  const s = new Store(":memory:");
  assert.ok(s.playbooks().length >= 6);
  const pb = s.savePlaybook({ name: "Mine", kind: "interview", instructions: "x", context: "resume" });
  assert.equal(s.playbook(pb.id)?.context, "resume");
  const p = s.upsertPerson({ name: "Priya Raman", org: "Lumen" });
  assert.equal(s.upsertPerson({ name: "priya raman", role: "EM" }).id, p.id);
  assert.equal(s.person(p.id)?.role, "EM");
  s.addFact(p.id, "Moved billing to Kafka", null);
  assert.equal(s.addFact(p.id, "moved billing to kafka", null), null);
  s.saveSession({ id: "s1", title: "Interview", playbookId: "interview", startedAt: 1, endedAt: 2, utterances: [u("them", "We care about idempotency a lot", 1, 2)], cards: [], stats: null, people: [p] });
  s.applyDebrief("s1", { title: "Lumen interview", summary: "Talked Kafka", decisions: [], actionItems: [{ owner: "Me", text: "Send the design doc", due: "Friday" }], followUp: { to: "", subject: "", body: "" }, coaching: { strengths: [], improve: [], moments: [] }, people: [{ name: "Priya Raman", org: "Lumen", role: "EM", facts: ["Has a dog named Mochi"] }] });
  assert.ok(s.factsFor(p.id).some((f) => f.text.includes("Mochi")));
  assert.ok(s.openPromises().some((x) => x.fact.text.includes("design doc")));
  assert.ok(s.search("idempotency").length >= 1);
  assert.ok(s.search("Mochi dog").some((r) => r.text.includes("Mochi")));
  assert.equal(s.session("s1")?.title, "Lumen interview");
  assert.equal(s.sessionsWith(p.id).length, 1);
  assert.equal(ftsQuery("what did she say?"), '"she"* OR "say"*');
  s.deleteSession("s1");
  assert.equal(s.sessions().length, 0);
  assert.ok(!s.factsFor(p.id).some((f) => f.text.includes("Mochi")));
});

test("context and transcript formatting", () => {
  const ctx = buildContext({ id: "x", name: "Interview", kind: "interview", instructions: "be crisp", context: "Abridge intern", builtin: true }, [{ id: "p", name: "Priya", org: "Lumen", role: "EM", notes: "", lastSeen: 0 }], () => [{ id: "f", personId: "p", text: "Loves Kafka", sessionId: null, at: 0 }]);
  assert.match(ctx, /Abridge intern/);
  assert.match(ctx, /Loves Kafka/);
  const t = formatTranscript([u("them", "a".repeat(50), 0, 1), u("me", "hello", 1, 2)], 20);
  assert.equal(t, "[Me] hello");
});

test("live session: rehearsal script auto-suggests on questions, recalls people, debriefs", async () => {
  const store = new Store(":memory:");
  const known = store.upsertPerson({ name: "Marcus Webb", org: "Northline Clinics" });
  store.addFact(known.id, "Wants a SOC 2 report before any pilot", null);
  const pb = store.playbook("interview");
  const live = new LiveSession({ brain: new RehearsalBrain(), memory: store, playbook: pb ? { ...pb, context: "- Interned at Abridge on the clinical notes streaming pipeline, cut p99 latency to under 1s.\n- Interned at AVEVA on industrial data tooling." } : null, attendees: [], insightsEveryMs: 200, suggestDebounceMs: 50 });
  const cards: string[] = [];
  live.on("card:done", (c) => cards.push(`${c.kind}:${c.title}:${c.body}`));
  const script = [
    ...SCRIPTS.interview.lines,
    { speaker: "them" as const, text: "By the way, Marcus Webb from Northline referred you." },
  ];
  const player = new ScriptPlayer(script, 25);
  player.on("speech", (e) => live.ingest(e));
  await new Promise<void>((resolve) => {
    player.on("done", resolve);
    player.start();
  });
  await sleep(600);
  await live.runInsights(true);
  assert.ok(cards.some((c) => c.startsWith("suggest:")), "suggestion fired");
  assert.ok(cards.some((c) => c.startsWith("suggest:") && /Abridge|clarify requirements/i.test(c)), "suggestion uses background");
  assert.ok(cards.some((c) => c.startsWith("recall:Marcus Webb")), "recall fired");
  assert.ok(cards.some((c) => c.startsWith("define:")), "glossary fired");
  assert.ok(live.utterances.length >= 7);
  assert.ok(live.utterances.filter((x) => x.speaker === "me").length >= 2);
  const d = await live.finish();
  assert.ok(d && d.people.some((p) => p.name === "Priya Raman"));
});

test("live session: echo of their words on my mic is dropped", () => {
  const live = new LiveSession({ brain: new RehearsalBrain(), memory: new Store(":memory:"), playbook: null, attendees: [], insights: false, autoSuggest: false });
  const drops: string[] = [];
  live.on("drop", (id) => drops.push(id));
  live.ingest({ speaker: "them", text: "How would you design a rate limiter for bursty traffic?", final: true, start: 0, end: 3000 });
  live.ingest({ speaker: "me", text: "design a rate limiter for bursty traffic", final: false, start: 500, end: 3100 });
  live.ingest({ speaker: "me", text: "design a rate limiter for bursty traffic", final: true, start: 500, end: 3200 });
  assert.equal(drops.length, 1);
  assert.equal(live.utterances.length, 1);
  live.dispose();
});

test("live session: newer question cancels in-flight answer", async () => {
  let aborted = 0;
  const slow: Brain = {
    name: "slow",
    async stream(_req: BrainRequest, onText, signal) {
      for (let i = 0; i < 20; i++) {
        if (signal?.aborted) {
          aborted++;
          const e = new Error("aborted");
          e.name = "AbortError";
          throw e;
        }
        onText("x");
        await sleep(10);
      }
      return "done";
    },
    async json<T>() {
      return { cards: [] } as T;
    },
  };
  const live = new LiveSession({ brain: slow, memory: new Store(":memory:"), playbook: null, attendees: [], insights: false });
  const a = live.assist("answer", { question: "first?" });
  await sleep(30);
  const b = live.assist("answer", { question: "second?" });
  assert.equal(await a, null);
  assert.ok(await b);
  assert.equal(aborted, 1);
  live.dispose();
});

test("practice session: asks, listens, grades, asks again", async () => {
  const p = new PracticeSession({ brain: new RehearsalBrain(), playbook: { id: "i", name: "Interview", kind: "interview", instructions: "", context: "", builtin: true }, silenceMs: 30 });
  const titles: string[] = [];
  p.on("card", (c) => titles.push(c.title));
  await p.ask();
  p.ingest({ speaker: "me", text: "I built a streaming pipeline at Abridge that cut p99 latency from 4 seconds to under 1 second for 2000 clinicians.", final: true, start: 0, end: 1 });
  await sleep(400);
  assert.equal(p.grades.length, 1);
  assert.ok(p.grades[0].score >= 3);
  assert.equal(titles.filter((t) => t === "They ask").length, 2);
  p.dispose();
});

test("deepgram turn assembly: interim, final segments, speech_final, utterance end", async () => {
  const { TurnAssembler } = await import("../src/engine/stt.ts");
  const t = new TurnAssembler("them", 1000);
  const r = (text: string, is_final: boolean, speech_final: boolean, start: number) => JSON.stringify({ type: "Results", is_final, speech_final, start, duration: 1, channel: { alternatives: [{ transcript: text, words: [] }] } });
  assert.deepEqual(t.push(r("how would", false, false, 0)).map((e) => [e.text, e.final]), [["how would", false]]);
  assert.deepEqual(t.push(r("How would you", true, false, 0)).map((e) => [e.text, e.final]), [["How would you", false]]);
  assert.deepEqual(t.push(r("design it", false, false, 1)).map((e) => e.text), ["How would you design it"]);
  const fin = t.push(r("design it?", true, true, 1));
  assert.equal(fin.length, 1);
  assert.equal(fin[0].text, "How would you design it?");
  assert.equal(fin[0].final, true);
  assert.equal(fin[0].start, 1000);
  assert.equal(fin[0].end, 3000);
  t.push(r("Okay", true, false, 5));
  assert.equal(t.push(JSON.stringify({ type: "UtteranceEnd" }))[0].text, "Okay");
  assert.deepEqual(t.push("not json"), []);
});
