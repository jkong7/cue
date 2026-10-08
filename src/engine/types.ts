export type Speaker = "me" | "them";

export interface Utterance {
  id: string;
  speaker: Speaker;
  text: string;
  start: number;
  end: number;
  final: boolean;
}

export interface SpeechEvent {
  speaker: Speaker;
  text: string;
  final: boolean;
  start: number;
  end: number;
}

export type CardKind = "answer" | "suggest" | "define" | "recall" | "fact" | "tip" | "coach" | "practice" | "brief";

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  body: string;
  at: number;
  done: boolean;
  trigger?: string;
}

export interface CoachStats {
  talkRatio: number;
  myWords: number;
  theirWords: number;
  wpm: number;
  fillers: number;
  fillerRate: number;
  longestMonologue: number;
  currentMonologue: number;
  questionsAsked: number;
}

export interface Playbook {
  id: string;
  name: string;
  kind: string;
  instructions: string;
  context: string;
  builtin: boolean;
}

export interface Person {
  id: string;
  name: string;
  org: string;
  role: string;
  notes: string;
  lastSeen: number;
}

export interface Fact {
  id: string;
  personId: string | null;
  text: string;
  sessionId: string | null;
  at: number;
}

export interface ActionItem {
  owner: string;
  text: string;
  due: string;
}

export interface Debrief {
  title: string;
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
  followUp: { to: string; subject: string; body: string };
  coaching: { strengths: string[]; improve: string[]; moments: { quote: string; note: string }[] };
  people: { name: string; org: string; role: string; facts: string[] }[];
}

export interface PracticeGrade {
  score: number;
  worked: string[];
  improve: string[];
  stronger: string;
}

export interface MemoryView {
  people(): Person[];
  factsFor(personId: string): Fact[];
  search(query: string, limit: number): { text: string; source: string }[];
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface BrainRequest {
  task: "assist" | "insights" | "debrief" | "practice-ask" | "practice-grade" | "memory" | "brief";
  system: string;
  context: string;
  prompt: string;
  image?: string;
  effort?: Effort;
  maxTokens?: number;
}

export interface Brain {
  readonly name: string;
  stream(req: BrainRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<string>;
  json<T>(req: BrainRequest, schema: Record<string, unknown>): Promise<T>;
}
