const OPENERS = [
  "what", "how", "why", "when", "where", "who", "whom", "which", "whose",
  "can you", "could you", "would you", "will you", "do you", "did you", "does", "have you", "has", "are you", "is there", "is it", "were you", "should",
  "tell me", "walk me through", "talk me through", "describe", "explain", "talk about", "give me an example", "give me", "share", "help me understand", "thoughts on", "any thoughts", "curious",
];

const CONTINUATIONS = ["right?", "yeah?", "ok?", "okay?", "you know?", "make sense?"];

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9'?\s]/g, " ").replace(/\s+/g, " ").trim();

export function questionScore(text: string): number {
  const t = normalize(text);
  if (t.split(" ").length < 3) return 0;
  let score = 0;
  if (t.endsWith("?") && !CONTINUATIONS.some((c) => t.endsWith(c))) score += 0.6;
  const sentences = t.split(/(?<=[?])\s+|(?<=\.)\s+/);
  const last = sentences[sentences.length - 1] ?? t;
  if (OPENERS.some((o) => last.startsWith(o + " ") || last.startsWith(o + "?"))) score += 0.5;
  else if (OPENERS.some((o) => t.includes(" " + o + " "))) score += 0.2;
  if (/\b(you|your|you've|you'd)\b/.test(last)) score += 0.15;
  if (/\b(i think|i guess|i mean|anyway|so yeah)\b$/.test(t)) score -= 0.3;
  return Math.max(0, Math.min(1, score));
}

export const isQuestion = (text: string, threshold = 0.55) => questionScore(text) >= threshold;

export function lastQuestion(text: string): string {
  const parts = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) if (questionScore(parts[i]) >= 0.5) return parts.slice(i).join(" ");
  return text;
}

const tokens = (t: string) => normalize(t).replace(/\?/g, "").split(" ").filter((w) => w.length > 2);

export function overlap(a: string, b: string): number {
  const ta = tokens(a);
  if (ta.length < 3) return 0;
  const tb = new Set(tokens(b));
  return ta.filter((w) => tb.has(w)).length / ta.length;
}
