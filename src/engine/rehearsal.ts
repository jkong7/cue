import type { Brain, BrainRequest, Debrief, PracticeGrade } from "./types.ts";
import { lastQuestion, questionScore } from "./detect.ts";

const GLOSSARY: Record<string, string> = {
  "idempotency": "Doing the same request twice has the same effect as once. Usually an idempotency key stored with the result.",
  "idempotent": "Safe to retry: repeating the call does not change the outcome.",
  "p99": "99th percentile latency: the slowest 1% of requests are slower than this.",
  "soc 2": "Security audit standard for SaaS vendors. Type II covers controls over 3-12 months.",
  "arr": "Annual recurring revenue: monthly recurring revenue x 12.",
  "cac": "Customer acquisition cost: sales and marketing spend / new customers.",
  "ltv": "Lifetime value: gross margin per customer over their lifetime.",
  "sharding": "Splitting data across databases by a key so each holds a slice.",
  "kafka": "Distributed log for event streaming; consumers read from partitions at their own offset.",
  "rag": "Retrieval-augmented generation: fetch relevant docs, put them in the prompt.",
  "eventual consistency": "Replicas converge over time; reads may briefly be stale.",
  "backpressure": "Slowing producers when consumers fall behind instead of dropping or buffering forever.",
  "okr": "Objectives and key results: a goal plus 2-4 measurable outcomes.",
  "nps": "Net promoter score: % promoters (9-10) minus % detractors (0-6).",
  "churn": "Share of customers or revenue lost in a period.",
  "series a": "First major priced venture round, typically $8-20M after product-market signal.",
  "rate limiting": "Capping requests per client per window, often token bucket or sliding window.",
  "cap theorem": "Under a network partition you choose consistency or availability.",
  "webhook": "An HTTP callback the provider sends you when an event happens.",
  "hipaa": "US health privacy law; vendors touching patient data sign a BAA.",
  "redlines": "Proposed edits to a contract draft.",
  "procurement": "The buyer's purchasing process: security review, legal, vendor setup.",
};

const tag = (text: string, name: string) => text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

function background(context: string): string[] {
  return lines(tag(context, "user_background")).map((l) => l.replace(/^[-*]\s*/, "")).filter((l) => l.length > 20);
}

function pick(bg: string[], q: string): string[] {
  const qw = new Set(q.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  return [...bg].map((b) => ({ b, s: (b.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => qw.has(w)).length })).sort((a, b) => b.s - a.s).map((x) => x.b);
}

function assist(req: BrainRequest): string {
  const transcript = tag(req.prompt, "transcript");
  const asked = tag(req.prompt, "question") || lastQuestion(lines(transcript).filter((l) => l.startsWith("[Them]")).pop()?.replace("[Them] ", "") ?? "");
  const bg = pick(background(req.context), asked);
  const lower = asked.toLowerCase();
  if (req.image && !asked) return "**On screen:** a screenshot was captured. Rehearsal mode can't read images; add an ANTHROPIC_API_KEY to get real answers about what's on screen.";
  if (/tell me about yourself|walk me through your (background|resume)|introduce yourself/.test(lower)) {
    return `**"I'm a builder who ships end to end, most recently ${bg[0] ? bg[0].replace(/\.$/, "").toLowerCase() : "on production AI systems"}."**\n- Present: what you're doing now and the one result you're proudest of\n- Past: ${bg[1] ? bg[1].replace(/\.$/, "") : "the experience that set it up"}\n- Future: why this role is the obvious next step`;
  }
  if (/weakness|fail|mistake|conflict|disagree/.test(lower)) {
    return `**Use one real story with a clean arc: situation, what you did, what changed.**\n- Name the mistake plainly, no humble-brag\n- Show the fix you put in place${bg[0] ? ` (e.g. from: ${bg[0].slice(0, 70)}...)` : ""}\n- End on what you do differently now`;
  }
  if (/design|scale|system|architecture|rate limit|database/.test(lower)) {
    return `**"Let me clarify requirements first: expected QPS, read/write mix, and consistency needs."**\n- Start simple: API layer, stateless service, one primary DB with a cache\n- Scale reads with replicas + cache; writes with partitioning by a stable key\n- Call out the bottleneck you'd measure first and how you'd load test it`;
  }
  if (/price|pricing|cost|budget|discount/.test(lower)) {
    return `**"Before numbers, can I ask what you're comparing us against and what a win looks like in 90 days?"**\n- Anchor on value: hours or dollars saved per month\n- Offer a pilot scope instead of a discount\n- Get the decision process and timeline on the table`;
  }
  if (!asked) return "**Nothing pending.** Next move: ask them what success looks like for them by the end of this conversation.";
  const support = bg.slice(0, 2).map((b) => `- ${b}`).join("\n");
  return `**"Good question. ${asked.endsWith("?") ? "The short answer is yes, and here's how I'd think about it." : "Here's how I'd frame it."}"**\n${support || "- Give one concrete example with a number in it\n- Tie it back to what they care about"}\n- Close by checking: "Does that get at what you were asking?"`;
}

function insights(req: BrainRequest): { cards: { kind: string; title: string; body: string }[] } {
  const transcript = tag(req.prompt, "transcript").toLowerCase();
  const shown = new Set(lines(tag(req.prompt, "already_shown")).map((s) => s.toLowerCase()));
  const cards = Object.entries(GLOSSARY)
    .filter(([term]) => new RegExp(`\\b${term}\\b`).test(transcript) && !shown.has(term.toUpperCase().toLowerCase()) && !shown.has(term))
    .slice(0, 2)
    .map(([term, body]) => ({ kind: "define", title: term.length <= 4 ? term.toUpperCase() : term[0].toUpperCase() + term.slice(1), body }));
  return { cards: cards.filter((c) => !shown.has(c.title.toLowerCase())) };
}

function debrief(req: BrainRequest): Debrief {
  const transcript = lines(tag(req.prompt, "transcript"));
  const them = transcript.filter((l) => l.startsWith("[Them]")).map((l) => l.slice(7));
  const me = transcript.filter((l) => l.startsWith("[Me]")).map((l) => l.slice(5));
  const all = transcript.map((l) => l.replace(/^\[(Me|Them)\]\s*/, ""));
  const nameMatch = all.join(" ").match(/\b(?:I'm|I am|this is|my name is)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
  const name = nameMatch?.[1] ?? "";
  const orgMatch = all.join(" ").match(/\b(?:at|from|here at)\s+([A-Z][A-Za-z]+)/);
  const commit = (s: string) => /\b(i'll|i will|we'll|we will|will send|follow up|next step|by (monday|tuesday|wednesday|thursday|friday|next week))\b/i.test(s);
  const actionItems = transcript.filter((l) => commit(l)).slice(0, 5).map((l) => ({ owner: l.startsWith("[Me]") ? "Me" : name || "Them", text: l.replace(/^\[(Me|Them)\]\s*/, "").slice(0, 140), due: (l.match(/by \w+( \w+)?|next week|tomorrow/i)?.[0] ?? "") }));
  const questions = them.filter((t) => questionScore(t) >= 0.55);
  return {
    title: name ? `Conversation with ${name}` : "Conversation",
    summary: `${them.length} turns from them, ${me.length} from you. They focused on: ${questions.slice(0, 3).map((q) => `"${lastQuestion(q).slice(0, 80)}"`).join(", ") || "general discussion"}. (Rehearsal-mode summary; add an API key for a real one.)`,
    decisions: all.filter((s) => /\b(let's|we'll go with|decided|agreed)\b/i.test(s)).slice(0, 3),
    actionItems,
    followUp: {
      to: name,
      subject: "Thanks for today",
      body: `Hi ${name.split(" ")[0] || "there"},\n\nThanks for the time today. I enjoyed the conversation and learning more about ${orgMatch?.[1] ? `what the team at ${orgMatch[1]} is working on` : "what you're working on"}.\n\n${actionItems.find((a) => a.owner === "Me") ? `As promised: ${actionItems.find((a) => a.owner === "Me")!.text}\n\n` : ""}Looking forward to next steps.\n\nJonny`,
    },
    coaching: {
      strengths: me.some((t) => /\d/.test(t)) ? ["You used concrete numbers, which made answers credible."] : ["You stayed engaged and responsive."],
      improve: me.filter((t) => t.split(" ").length > 90).length ? ["Some answers ran long. Lead with the headline, then detail."] : ["Ask one more question back to them."],
      moments: me.slice(0, 1).map((q) => ({ quote: q.slice(0, 90), note: "Opening answer set the tone." })),
    },
    people: name ? [{ name, org: orgMatch?.[1] ?? "", role: "", facts: them.filter((t) => /\b(we're|our team|i run|i lead|my team|we just)\b/i.test(t)).slice(0, 3) }] : [],
  };
}

const PRACTICE_BANK: Record<string, string[]> = {
  interview: [
    "Thanks for making the time. To start, walk me through your background and what brings you here.",
    "Tell me about the most technically difficult thing you've built. What made it hard?",
    "How did you measure whether that worked? What were the numbers?",
    "Tell me about a time you disagreed with a teammate on a technical decision.",
    "How would you design a rate limiter for a public API?",
    "What would you want to work on in your first 90 days here?",
  ],
  sales: [
    "Honestly we already use a spreadsheet for this and it's fine. Why would we switch?",
    "What does this cost, and why is it worth it?",
    "Our security team will want to review this. What do you have?",
    "Who else like us is using it?",
    "If we did a pilot, what would success look like?",
  ],
  default: [
    "Give me the one-minute version of what you're working on.",
    "What's the biggest risk in that plan?",
    "Why now?",
    "What do you need from me?",
  ],
};

export class RehearsalBrain implements Brain {
  readonly name = "rehearsal";
  private asked = 0;

  async stream(req: BrainRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<string> {
    const text = req.task === "practice-ask" ? this.practiceAsk(req) : req.task === "memory" ? this.memory(req) : req.task === "brief" ? this.brief(req) : assist(req);
    for (const chunk of text.match(/.{1,14}(\s|$)|\S+/g) ?? [text]) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      onText(chunk);
      await sleep(18);
    }
    return text;
  }

  async json<T>(req: BrainRequest): Promise<T> {
    await sleep(120);
    if (req.task === "insights") return insights(req) as T;
    if (req.task === "debrief") return debrief(req) as T;
    if (req.task === "practice-grade") return this.grade(req) as T;
    throw new Error(`rehearsal brain has no json task ${req.task}`);
  }

  private practiceAsk(req: BrainRequest): string {
    const kind = tag(req.prompt, "kind") || "default";
    const bank = PRACTICE_BANK[kind] ?? PRACTICE_BANK.default;
    return bank[this.asked++ % bank.length];
  }

  private grade(req: BrainRequest): PracticeGrade {
    const answer = tag(req.prompt, "answer");
    const n = answer.split(/\s+/).filter(Boolean).length;
    const numbers = /\d/.test(answer);
    const score = Math.max(1, Math.min(5, 1 + (n > 25 ? 1 : 0) + (n > 60 ? 1 : 0) + (numbers ? 1 : 0) + (n < 200 ? 1 : 0)));
    return {
      score,
      worked: [n > 25 ? "You gave a full answer instead of a one-liner." : "You were concise.", ...(numbers ? ["Concrete numbers made it credible."] : [])],
      improve: [...(numbers ? [] : ["Add one measurable result (a number, a before/after)."]), ...(n > 200 ? ["Too long. Lead with the headline, cut the setup."] : []), "End by connecting it to what they need."],
      stronger: answer ? `${answer.split(/(?<=[.!?])\s+/)[0]} The result: [your number here]. That's why I'd bring the same approach here.` : "Answer out loud, then pause to get feedback.",
    };
  }

  private memory(req: BrainRequest): string {
    const excerpts = lines(tag(req.prompt, "excerpts"));
    if (!excerpts.length) return "I couldn't find anything about that in your past conversations.";
    return `From your history:\n${excerpts.slice(0, 4).map((e) => `- ${e}`).join("\n")}\n\n(Rehearsal mode lists the raw matches; add an API key for a written answer.)`;
  }

  private brief(req: BrainRequest): string {
    const people = lines(tag(req.context, "people_in_this_conversation"));
    return people.length ? `**You're meeting:**\n${people.slice(0, 6).join("\n")}\n\n**Ask:** what's changed since you last spoke.` : "**No history with these people yet.** Open by asking what they want out of the conversation.";
  }
}
