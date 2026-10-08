import type { Fact, Person } from "./types.ts";

export interface RecallHit {
  person: Person;
  facts: Fact[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentions(text: string, people: Person[]): Person[] {
  const hits: Person[] = [];
  for (const p of people) {
    const names = [p.name, p.name.split(" ")[0]].filter((n) => n.length >= 3);
    if (p.org && p.org.length >= 3) names.push(p.org);
    if (names.some((n) => new RegExp(`\\b${escape(n)}\\b`, "i").test(text))) hits.push(p);
  }
  return hits;
}

export class Recaller {
  private seen = new Set<string>();
  private people: () => Person[];
  private factsFor: (id: string) => Fact[];
  private exclude: Set<string>;

  constructor(people: () => Person[], factsFor: (id: string) => Fact[], exclude: Set<string> = new Set()) {
    this.people = people;
    this.factsFor = factsFor;
    this.exclude = exclude;
  }

  check(text: string): RecallHit[] {
    const out: RecallHit[] = [];
    for (const person of mentions(text, this.people())) {
      if (this.seen.has(person.id) || this.exclude.has(person.id)) continue;
      const facts = this.factsFor(person.id);
      if (!facts.length && !person.notes) continue;
      this.seen.add(person.id);
      out.push({ person, facts: facts.slice(0, 4) });
    }
    return out;
  }
}
