import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Card, CoachStats, Debrief, Fact, MemoryView, Person, Playbook, Utterance } from "./types.ts";
import { BUILTIN_PLAYBOOKS } from "./playbooks.ts";

export interface SessionRow {
  id: string;
  title: string;
  playbookId: string;
  startedAt: number;
  endedAt: number | null;
  debrief: Debrief | null;
  stats: CoachStats | null;
  people: Person[];
}

export interface SessionDetail extends SessionRow {
  utterances: Utterance[];
  cards: Card[];
}

const STOP = new Set(["the", "and", "for", "that", "with", "you", "what", "how", "did", "was", "are", "about", "this", "have", "they", "said", "when", "who", "does", "from"]);

export function ftsQuery(q: string): string {
  const terms = (q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !STOP.has(t));
  return [...new Set(terms)].slice(0, 12).map((t) => `"${t}"*`).join(" OR ");
}

const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });

type Row = Record<string, unknown>;

export class Store implements MemoryView {
  db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS playbooks (id TEXT PRIMARY KEY, name TEXT, kind TEXT, instructions TEXT, context TEXT, builtin INTEGER, sort INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT, org TEXT, role TEXT, notes TEXT, last_seen INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS people_name ON people (lower(name));
      CREATE TABLE IF NOT EXISTS facts (id TEXT PRIMARY KEY, person_id TEXT, text TEXT, session_id TEXT, at INTEGER);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT, playbook_id TEXT, started_at INTEGER, ended_at INTEGER, debrief TEXT, stats TEXT);
      CREATE TABLE IF NOT EXISTS session_people (session_id TEXT, person_id TEXT, PRIMARY KEY (session_id, person_id));
      CREATE TABLE IF NOT EXISTS utterances (id TEXT PRIMARY KEY, session_id TEXT, speaker TEXT, text TEXT, start INTEGER, end INTEGER);
      CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, session_id TEXT, kind TEXT, title TEXT, body TEXT, at INTEGER);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5 (text, kind UNINDEXED, ref UNINDEXED, session_id UNINDEXED);
    `);
    const insert = this.db.prepare("INSERT OR IGNORE INTO playbooks (id, name, kind, instructions, context, builtin, sort) VALUES (?, ?, ?, ?, ?, 1, ?)");
    BUILTIN_PLAYBOOKS.forEach((p, i) => insert.run(p.id, p.name, p.kind, p.instructions, p.context, i));
  }

  close() {
    this.db.close();
  }

  getSetting(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
    return (r?.value as string) ?? null;
  }

  setSetting(key: string, value: string) {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  playbooks(): Playbook[] {
    return (this.db.prepare("SELECT * FROM playbooks ORDER BY builtin DESC, sort, name").all() as Row[]).map(this.toPlaybook);
  }

  playbook(id: string): Playbook | null {
    const r = this.db.prepare("SELECT * FROM playbooks WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toPlaybook(r) : null;
  }

  savePlaybook(p: Omit<Playbook, "builtin" | "id"> & { id?: string }): Playbook {
    const id = p.id || randomUUID();
    const existing = this.playbook(id);
    this.db.prepare(`INSERT INTO playbooks (id, name, kind, instructions, context, builtin, sort) VALUES (?, ?, ?, ?, ?, 0, 100)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, instructions = excluded.instructions, context = excluded.context`)
      .run(id, p.name, p.kind, p.instructions, p.context);
    return { ...p, id, builtin: existing?.builtin ?? false };
  }

  deletePlaybook(id: string) {
    this.db.prepare("DELETE FROM playbooks WHERE id = ? AND builtin = 0").run(id);
  }

  private toPlaybook = (r: Row): Playbook => ({ id: r.id as string, name: r.name as string, kind: r.kind as string, instructions: r.instructions as string, context: r.context as string, builtin: !!r.builtin });

  private toPerson = (r: Row): Person => ({ id: r.id as string, name: r.name as string, org: (r.org as string) ?? "", role: (r.role as string) ?? "", notes: (r.notes as string) ?? "", lastSeen: (r.last_seen as number) ?? 0 });

  people(): Person[] {
    return (this.db.prepare("SELECT * FROM people ORDER BY last_seen DESC, name").all() as Row[]).map(this.toPerson);
  }

  person(id: string): Person | null {
    const r = this.db.prepare("SELECT * FROM people WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toPerson(r) : null;
  }

  personByName(name: string): Person | null {
    const r = this.db.prepare("SELECT * FROM people WHERE lower(name) = lower(?)").get(name.trim()) as Row | undefined;
    return r ? this.toPerson(r) : null;
  }

  upsertPerson(p: { name: string; org?: string; role?: string; notes?: string; lastSeen?: number }): Person {
    const name = p.name.trim();
    const existing = this.personByName(name);
    if (existing) {
      const next = { ...existing, org: p.org || existing.org, role: p.role || existing.role, notes: p.notes ?? existing.notes, lastSeen: Math.max(existing.lastSeen, p.lastSeen ?? 0) };
      this.db.prepare("UPDATE people SET org = ?, role = ?, notes = ?, last_seen = ? WHERE id = ?").run(next.org, next.role, next.notes, next.lastSeen, next.id);
      return next;
    }
    const person: Person = { id: randomUUID(), name, org: p.org ?? "", role: p.role ?? "", notes: p.notes ?? "", lastSeen: p.lastSeen ?? 0 };
    this.db.prepare("INSERT INTO people (id, name, org, role, notes, last_seen) VALUES (?, ?, ?, ?, ?, ?)").run(person.id, person.name, person.org, person.role, person.notes, person.lastSeen);
    return person;
  }

  updatePerson(p: Person) {
    this.db.prepare("UPDATE people SET name = ?, org = ?, role = ?, notes = ? WHERE id = ?").run(p.name, p.org, p.role, p.notes, p.id);
  }

  deletePerson(id: string) {
    this.db.prepare("DELETE FROM people WHERE id = ?").run(id);
    for (const f of this.factsFor(id)) this.deleteFact(f.id);
    this.db.prepare("DELETE FROM session_people WHERE person_id = ?").run(id);
  }

  factsFor(personId: string): Fact[] {
    return (this.db.prepare("SELECT * FROM facts WHERE person_id = ? ORDER BY at DESC").all(personId) as Row[])
      .map((r) => ({ id: r.id as string, personId: r.person_id as string, text: r.text as string, sessionId: (r.session_id as string) ?? null, at: r.at as number }));
  }

  addFact(personId: string | null, text: string, sessionId: string | null, at = Date.now()): Fact | null {
    const clean = text.trim();
    if (!clean) return null;
    if (personId) {
      const dup = this.factsFor(personId).some((f) => f.text.toLowerCase() === clean.toLowerCase());
      if (dup) return null;
    }
    const fact: Fact = { id: randomUUID(), personId, text: clean, sessionId, at };
    this.db.prepare("INSERT INTO facts (id, person_id, text, session_id, at) VALUES (?, ?, ?, ?, ?)").run(fact.id, personId, clean, sessionId, at);
    this.db.prepare("INSERT INTO search_fts (text, kind, ref, session_id) VALUES (?, 'fact', ?, ?)").run(clean, fact.id, sessionId);
    return fact;
  }

  deleteFact(id: string) {
    this.db.prepare("DELETE FROM facts WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM search_fts WHERE kind = 'fact' AND ref = ?").run(id);
  }

  saveSession(s: { id: string; title: string; playbookId: string; startedAt: number; endedAt: number; utterances: Utterance[]; cards: Card[]; stats: CoachStats | null; people: Person[] }) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT OR REPLACE INTO sessions (id, title, playbook_id, started_at, ended_at, debrief, stats) VALUES (?, ?, ?, ?, ?, NULL, ?)")
        .run(s.id, s.title, s.playbookId, s.startedAt, s.endedAt, s.stats ? JSON.stringify(s.stats) : null);
      const u = this.db.prepare("INSERT OR REPLACE INTO utterances (id, session_id, speaker, text, start, end) VALUES (?, ?, ?, ?, ?, ?)");
      const f = this.db.prepare("INSERT INTO search_fts (text, kind, ref, session_id) VALUES (?, 'utterance', ?, ?)");
      for (const x of s.utterances) {
        u.run(x.id, s.id, x.speaker, x.text, x.start, x.end);
        f.run(x.text, x.id, s.id);
      }
      const c = this.db.prepare("INSERT OR REPLACE INTO cards (id, session_id, kind, title, body, at) VALUES (?, ?, ?, ?, ?, ?)");
      for (const x of s.cards) c.run(x.id, s.id, x.kind, x.title, x.body, x.at);
      const sp = this.db.prepare("INSERT OR IGNORE INTO session_people (session_id, person_id) VALUES (?, ?)");
      for (const p of s.people) {
        sp.run(s.id, p.id);
        this.db.prepare("UPDATE people SET last_seen = MAX(COALESCE(last_seen, 0), ?) WHERE id = ?").run(s.endedAt, p.id);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  applyDebrief(sessionId: string, d: Debrief) {
    this.db.prepare("UPDATE sessions SET debrief = ?, title = ? WHERE id = ?").run(JSON.stringify(d), d.title, sessionId);
    this.db.prepare("INSERT INTO search_fts (text, kind, ref, session_id) VALUES (?, 'summary', ?, ?)").run(`${d.title}. ${d.summary} ${d.decisions.join(". ")} ${d.actionItems.map((a) => `${a.owner}: ${a.text}`).join(". ")}`, sessionId, sessionId);
    const ended = (this.db.prepare("SELECT ended_at FROM sessions WHERE id = ?").get(sessionId) as Row | undefined)?.ended_at as number | undefined;
    for (const p of d.people) {
      if (!p.name.trim()) continue;
      const person = this.upsertPerson({ name: p.name, org: p.org, role: p.role, lastSeen: ended ?? Date.now() });
      this.db.prepare("INSERT OR IGNORE INTO session_people (session_id, person_id) VALUES (?, ?)").run(sessionId, person.id);
      for (const fact of p.facts) this.addFact(person.id, fact, sessionId, ended ?? Date.now());
    }
    for (const a of d.actionItems.filter((x) => /^(me|i|jonny|you)$/i.test(x.owner.trim()))) {
      const people = this.sessionPeople(sessionId);
      if (people[0]) this.addFact(people[0].id, `I promised: ${a.text}${a.due ? ` (${a.due})` : ""}`, sessionId, ended ?? Date.now());
    }
  }

  private sessionPeople(sessionId: string): Person[] {
    return (this.db.prepare("SELECT p.* FROM people p JOIN session_people sp ON sp.person_id = p.id WHERE sp.session_id = ?").all(sessionId) as Row[]).map(this.toPerson);
  }

  private toSession = (r: Row): SessionRow => ({
    id: r.id as string,
    title: r.title as string,
    playbookId: r.playbook_id as string,
    startedAt: r.started_at as number,
    endedAt: (r.ended_at as number) ?? null,
    debrief: r.debrief ? JSON.parse(r.debrief as string) : null,
    stats: r.stats ? JSON.parse(r.stats as string) : null,
    people: this.sessionPeople(r.id as string),
  });

  sessions(limit = 200): SessionRow[] {
    return (this.db.prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?").all(limit) as Row[]).map(this.toSession);
  }

  sessionsWith(personId: string): SessionRow[] {
    return (this.db.prepare("SELECT s.* FROM sessions s JOIN session_people sp ON sp.session_id = s.id WHERE sp.person_id = ? ORDER BY s.started_at DESC").all(personId) as Row[]).map(this.toSession);
  }

  session(id: string): SessionDetail | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    const utterances = (this.db.prepare("SELECT * FROM utterances WHERE session_id = ? ORDER BY start").all(id) as Row[])
      .map((u) => ({ id: u.id as string, speaker: u.speaker as "me" | "them", text: u.text as string, start: u.start as number, end: u.end as number, final: true }));
    const cards = (this.db.prepare("SELECT * FROM cards WHERE session_id = ? ORDER BY at").all(id) as Row[])
      .map((c) => ({ id: c.id as string, kind: c.kind as Card["kind"], title: c.title as string, body: c.body as string, at: c.at as number, done: true }));
    return { ...this.toSession(r), utterances, cards };
  }

  deleteSession(id: string) {
    for (const t of ["utterances", "cards", "session_people", "search_fts"]) this.db.prepare(`DELETE FROM ${t} WHERE session_id = ?`).run(id);
    this.db.prepare("DELETE FROM facts WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  search(query: string, limit = 8): { text: string; source: string; sessionId: string | null; kind: string }[] {
    const q = ftsQuery(query);
    if (!q) return [];
    const rows = this.db.prepare(`SELECT f.text, f.kind, f.session_id, s.title, s.started_at, u.speaker
      FROM search_fts f LEFT JOIN sessions s ON s.id = f.session_id LEFT JOIN utterances u ON u.id = f.ref AND f.kind = 'utterance'
      WHERE search_fts MATCH ? ORDER BY bm25(search_fts) LIMIT ?`).all(q, limit) as Row[];
    return rows.map((r) => ({
      text: r.kind === "utterance" ? `${r.speaker === "me" ? "I said" : "They said"}: "${r.text}"` : (r.text as string),
      source: r.title ? `${r.title}, ${fmtDate(r.started_at as number)}` : "memory",
      sessionId: (r.session_id as string) ?? null,
      kind: r.kind as string,
    }));
  }

  openPromises(): { person: Person; fact: Fact }[] {
    return (this.db.prepare("SELECT f.*, p.name, p.org, p.role, p.notes, p.last_seen FROM facts f JOIN people p ON p.id = f.person_id WHERE f.text LIKE 'I promised:%' ORDER BY f.at DESC LIMIT 20").all() as Row[])
      .map((r) => ({ person: this.toPerson({ ...r, id: r.person_id }), fact: { id: r.id as string, personId: r.person_id as string, text: r.text as string, sessionId: (r.session_id as string) ?? null, at: r.at as number } }));
  }
}
