import type { Playbook } from "./types.ts";

export const BUILTIN_PLAYBOOKS: Playbook[] = [
  {
    id: "interview",
    name: "Job interview",
    kind: "interview",
    builtin: true,
    instructions: `I'm the candidate. Help me give crisp, honest answers grounded in my real background.
- Behavioral: one real story, situation in a sentence, then what I did, then the measurable result. Never invent experience.
- Technical or system design: clarify requirements first, state the simple design, then scale it, then trade-offs.
- Coding on screen: approach in one line, clean code, complexity.
- Near the end, suggest one sharp question to ask them about their team or roadmap.`,
    context: "",
  },
  {
    id: "sales",
    name: "Sales call",
    kind: "sales",
    builtin: true,
    instructions: `I'm selling. Help me run discovery and handle objections.
- Prioritize questions that uncover pain, impact in numbers, decision process, timeline and budget.
- Objections: acknowledge, ask a clarifying question, then answer with proof (customer, number, demo).
- Never discount first; offer a scoped pilot.
- Keep me under 45% of the talking.`,
    context: "",
  },
  {
    id: "meeting",
    name: "Team meeting",
    kind: "meeting",
    builtin: true,
    instructions: `General meeting. Answer questions directed at me, keep track of decisions and owners, and flag anything I committed to.`,
    context: "",
  },
  {
    id: "lecture",
    name: "Class or lecture",
    kind: "lecture",
    builtin: true,
    instructions: `I'm a student in a lecture or seminar. Define new terms simply, connect ideas to what was said earlier, and when the professor asks the room a question, give me a short, correct answer I could say.`,
    context: "",
  },
  {
    id: "networking",
    name: "Coffee chat",
    kind: "networking",
    builtin: true,
    instructions: `Networking or coffee chat. Help me be curious and memorable: follow-up questions that go one level deeper on what they said, natural ways to mention what I'm working on, and a clean ask at the end (referral, intro, or next chat).`,
    context: "",
  },
  {
    id: "negotiation",
    name: "Negotiation",
    kind: "negotiation",
    builtin: true,
    instructions: `Negotiation (offer, contract, price). Help me hold anchors, trade instead of concede, label their constraints, and never accept on the call. Flag when they reveal leverage.`,
    context: "",
  },
];
