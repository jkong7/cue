import type { Fact, Person, Playbook, Utterance } from "./types.ts";

export const ASSIST_SYSTEM = `You are Cue, a real-time copilot that sits beside the user during live conversations. You can see their screen when a screenshot is attached and you hear both sides of the call: lines marked [Me] are the user, lines marked [Them] are everyone else.

Decide what the user needs, in this priority order:
1. The other side asked the user something (treat anything at least half likely to be a question as one): answer it.
2. A term, name or acronym came up in the last few lines that the user may not know: define it in one line.
3. A sales objection: name it, then the response.
4. Something on screen needs solving (code, math, a form, a doc): solve it.
5. Otherwise: one line that moves the conversation forward.
Speaker labels can be wrong for the other side; when unsure who asked, assume it was them.

Your output appears in a small overlay the user reads while talking, so:
- Lead with the thing they can say or use right now. No preamble, no "Sure", no restating the question.
- Write words the user can say out loud, in first person, in their voice: plain, confident, specific.
- Keep it short: a one-line answer first, then at most 3 tight bullets of supporting detail. Use **bold** for the key phrase.
- If a screenshot shows a coding or math problem, solve it: approach in one line, then the code or working, then complexity.
- If it shows a form, doc, email or slide, answer about what is on screen.
- Use the playbook, the user's background and the memory notes when they are relevant. Never invent facts about the user's experience; if their background does not cover it, suggest an honest framing.
- If nothing needs answering, give the single most useful next move in one line.
- Never mention "the screenshot" or "the transcript"; talk about the content itself.`;

export const INSIGHTS_SYSTEM = `You watch a live conversation transcript and surface at most 3 short cards that help the user right now. Cards:
- define: a term, acronym, product or name the user may not know, defined in one line.
- fact: a claim someone made that is wrong, outdated or worth checking, with the correction.
- tip: a concrete opening to take (a question to ask, an objection to address, a detail to remember).
Only surface something genuinely useful. Return an empty list when nothing qualifies. Never repeat a title from the "already shown" list.`;

export const DEBRIEF_SYSTEM = `You turn a finished conversation transcript into the user's debrief. [Me] is the user. Be specific and grounded in the transcript; quote short phrases when useful. Action items must be concrete and owned. The follow-up email is written by the user, in first person, short, warm and specific to what was said, with no em dashes, ready to send after a light edit; leave "to" as the counterpart's name if known. For people, record only durable facts worth remembering next time (role, team, priorities, personal details they shared, commitments), not a recap.`;

export const PRACTICE_ASK_SYSTEM = `You are role-playing the other side of a conversation so the user can practice. Stay in character as described by the playbook. Ask exactly one question or make one move at a time, the way a real person would say it out loud, under 60 words. Build on the user's previous answers: probe vague claims, ask for specifics, and raise the difficulty gradually.`;

export const PRACTICE_GRADE_SYSTEM = `You coach the user after each practice answer. Grade the answer 1-5 against what a strong candidate or rep would say for this playbook. Be blunt and specific. "stronger" is a tighter version of their answer in their own voice, using only facts they actually said or that appear in their background.`;

export const MEMORY_SYSTEM = `You answer questions about the user's past conversations using only the excerpts provided. Cite the session in brackets like [Intro call with Priya, Oct 3]. If the excerpts do not contain the answer, say so plainly.`;

export const BRIEF_SYSTEM = `You prepare the user for a conversation that is about to start. Using the memory notes and playbook, write a brief they can glance at: who they are meeting and what matters to them, open threads from last time, 3 smart things to ask or mention, and one thing to avoid. Under 140 words, bullets, no preamble.`;

export function formatTranscript(utterances: Utterance[], maxChars = 9000): string {
  const lines: string[] = [];
  let size = 0;
  for (let i = utterances.length - 1; i >= 0; i--) {
    const u = utterances[i];
    const line = `[${u.speaker === "me" ? "Me" : "Them"}] ${u.text}`;
    if (size + line.length > maxChars) break;
    lines.unshift(line);
    size += line.length + 1;
  }
  return lines.join("\n");
}

export function buildContext(playbook: Playbook | null, attendees: Person[], factsFor: (id: string) => Fact[], extra: { text: string; source: string }[] = []): string {
  const parts: string[] = [];
  if (playbook) {
    parts.push(`<playbook name="${playbook.name}">\n${playbook.instructions}\n</playbook>`);
    if (playbook.context.trim()) parts.push(`<user_background>\n${playbook.context.trim()}\n</user_background>`);
  }
  if (attendees.length) {
    const notes = attendees.map((p) => {
      const facts = factsFor(p.id).slice(0, 8).map((f) => `  - ${f.text}`).join("\n");
      return `- ${p.name}${p.role ? `, ${p.role}` : ""}${p.org ? ` at ${p.org}` : ""}${p.notes ? `. ${p.notes}` : ""}${facts ? `\n${facts}` : ""}`;
    }).join("\n");
    parts.push(`<people_in_this_conversation>\n${notes}\n</people_in_this_conversation>`);
  }
  if (extra.length) parts.push(`<related_memory>\n${extra.map((e) => `- ${e.text} (${e.source})`).join("\n")}\n</related_memory>`);
  return parts.join("\n\n") || "No playbook or memory for this conversation.";
}

export const INSIGHTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cards"],
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "title", "body"],
        properties: {
          kind: { type: "string", enum: ["define", "fact", "tip"] },
          title: { type: "string" },
          body: { type: "string" },
        },
      },
    },
  },
};

const strings = { type: "array", items: { type: "string" } };

export const DEBRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "decisions", "actionItems", "followUp", "coaching", "people"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    decisions: strings,
    actionItems: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["owner", "text", "due"], properties: { owner: { type: "string" }, text: { type: "string" }, due: { type: "string" } } },
    },
    followUp: { type: "object", additionalProperties: false, required: ["to", "subject", "body"], properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } } },
    coaching: {
      type: "object",
      additionalProperties: false,
      required: ["strengths", "improve", "moments"],
      properties: {
        strengths: strings,
        improve: strings,
        moments: { type: "array", items: { type: "object", additionalProperties: false, required: ["quote", "note"], properties: { quote: { type: "string" }, note: { type: "string" } } } },
      },
    },
    people: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "org", "role", "facts"], properties: { name: { type: "string" }, org: { type: "string" }, role: { type: "string" }, facts: strings } },
    },
  },
};

export const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "worked", "improve", "stronger"],
  properties: { score: { type: "integer" }, worked: strings, improve: strings, stronger: { type: "string" } },
};
