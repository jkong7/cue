import type { CoachStats, Utterance } from "./types.ts";
import { questionScore } from "./detect.ts";

const FILLERS = [/\bum+\b/g, /\buh+\b/g, /\berm\b/g, /\byou know\b/g, /\bbasically\b/g, /\bi mean\b/g, /\bsort of\b/g, /\bkind of\b/g, /\blike,/g, /\bliterally\b/g, /\bactually\b/g];

export const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function countFillers(text: string): number {
  const t = text.toLowerCase();
  return FILLERS.reduce((n, re) => n + (t.match(re)?.length ?? 0), 0);
}

export function coachStats(utterances: Utterance[], now: number): CoachStats {
  const finals = utterances.filter((u) => u.final);
  let myWords = 0, theirWords = 0, mySeconds = 0, fillers = 0, questionsAsked = 0;
  let longest = 0, runStart = -1, runEnd = -1;
  for (const u of finals) {
    const n = words(u.text);
    if (u.speaker === "me") {
      myWords += n;
      mySeconds += Math.max(0.5, (u.end - u.start) / 1000);
      fillers += countFillers(u.text);
      if (questionScore(u.text) >= 0.55) questionsAsked++;
      if (runStart < 0) runStart = u.start;
      runEnd = u.end;
      longest = Math.max(longest, (runEnd - runStart) / 1000);
    } else {
      theirWords += n;
      if (n > 3) runStart = -1;
    }
  }
  const last = finals[finals.length - 1];
  const currentMonologue = last?.speaker === "me" && runStart >= 0 ? Math.max(0, (Math.max(runEnd, now) - runStart) / 1000) : 0;
  const total = myWords + theirWords;
  return {
    talkRatio: total ? myWords / total : 0,
    myWords,
    theirWords,
    wpm: mySeconds > 5 ? Math.round(myWords / (mySeconds / 60)) : 0,
    fillers,
    fillerRate: myWords ? fillers / myWords * 100 : 0,
    longestMonologue: Math.round(longest),
    currentMonologue: Math.round(currentMonologue),
    questionsAsked,
  };
}

export interface NudgeRules {
  maxTalkRatio: number;
  maxMonologue: number;
  maxWpm: number;
  maxFillerRate: number;
}

export const NUDGE_RULES: Record<string, NudgeRules> = {
  interview: { maxTalkRatio: 0.7, maxMonologue: 120, maxWpm: 175, maxFillerRate: 4 },
  sales: { maxTalkRatio: 0.45, maxMonologue: 75, maxWpm: 170, maxFillerRate: 4 },
  meeting: { maxTalkRatio: 0.6, maxMonologue: 90, maxWpm: 180, maxFillerRate: 5 },
  default: { maxTalkRatio: 0.65, maxMonologue: 90, maxWpm: 180, maxFillerRate: 5 },
};

export function nudge(stats: CoachStats, kind: string): { key: string; text: string } | null {
  const r = NUDGE_RULES[kind] ?? NUDGE_RULES.default;
  if (stats.currentMonologue > r.maxMonologue) return { key: "monologue", text: `You've been talking ${stats.currentMonologue}s straight. Land the point and hand it back.` };
  if (stats.myWords + stats.theirWords > 250 && stats.talkRatio > r.maxTalkRatio) return { key: "ratio", text: `You're at ${Math.round(stats.talkRatio * 100)}% of the talking. Ask them something.` };
  if (stats.wpm > r.maxWpm && stats.myWords > 120) return { key: "pace", text: `${stats.wpm} words a minute. Slow down a notch.` };
  if (stats.fillerRate > r.maxFillerRate && stats.myWords > 150) return { key: "fillers", text: `Filler words are creeping up (${stats.fillers}). Pause instead of "um".` };
  return null;
}
