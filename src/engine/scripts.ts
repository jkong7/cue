import type { ScriptLine } from "./stt.ts";

export const SCRIPTS: Record<string, { title: string; attendee: { name: string; org: string; role: string }; lines: ScriptLine[] }> = {
  interview: {
    title: "Rehearsal: engineering interview",
    attendee: { name: "Priya Raman", org: "Lumen", role: "Engineering Manager" },
    lines: [
      { speaker: "them", text: "Hey, thanks for jumping on. I'm Priya Raman, I lead the platform team here at Lumen.", pause: 400 },
      { speaker: "me", text: "Thanks for having me Priya, really excited to chat." },
      { speaker: "them", text: "So we just moved our whole billing pipeline onto Kafka last quarter and idempotency has been the theme of my life. Anyway, to start, can you walk me through your background?" },
      { speaker: "me", text: "Sure. I'm a senior at Northwestern studying computer science. Most recently I interned at Abridge where I worked on the clinical notes pipeline, and before that I was at AVEVA working on industrial data tooling.", pause: 2600 },
      { speaker: "me", text: "Um, I basically like building things end to end, you know, from the data layer up to the product.", pause: 300 },
      { speaker: "them", text: "Nice. Tell me about the most technically difficult thing you built at Abridge. What made it hard?" },
      { speaker: "me", text: "The hardest part was latency on the streaming path. Notes had to show up while the doctor was still talking, so we cut p99 from about four seconds to under one second by moving to incremental processing.", pause: 2800 },
      { speaker: "them", text: "Okay, and how would you design a rate limiter for a public API that has bursty traffic?" },
    ],
  },
  sales: {
    title: "Rehearsal: discovery call",
    attendee: { name: "Marcus Webb", org: "Northline Clinics", role: "COO" },
    lines: [
      { speaker: "them", text: "Hi, Marcus Webb, I run operations at Northline Clinics. We have eleven locations across Illinois.", pause: 400 },
      { speaker: "me", text: "Great to meet you Marcus. Thanks for making time." },
      { speaker: "them", text: "Our front desk is drowning in referral faxes and our churn on new patients is ugly. We looked at two other vendors already but procurement wants a SOC 2 report before we even pilot." },
      { speaker: "me", text: "That makes sense. How many referrals are you handling a week right now?" },
      { speaker: "them", text: "Probably six hundred across the network. Honestly, what does this cost, and why is it worth it compared to just hiring two more coordinators?" },
    ],
  },
};
