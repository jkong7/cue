import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";
import { cue, Markdown, ago, KIND_LABEL } from "./shared.tsx";
import type { Card, CoachStats, Debrief, Fact, Person, Playbook, Utterance } from "../engine/types.ts";

interface SessionRow {
  id: string;
  title: string;
  playbookId: string;
  startedAt: number;
  endedAt: number | null;
  debrief: Debrief | null;
  stats: CoachStats | null;
  people: Person[];
}
interface SessionDetail extends SessionRow {
  utterances: Utterance[];
  cards: Card[];
}
interface PersonRow extends Person {
  factCount: number;
  sessionCount: number;
}
interface PersonDetail extends Person {
  facts: Fact[];
  sessions: SessionRow[];
}
interface Settings {
  model: string;
  liveEffort: string;
  stealth: boolean;
  autoSuggest: boolean;
  insights: boolean;
  coach: boolean;
  screenshotOnAsk: boolean;
  hasAnthropic: boolean;
  hasDeepgram: boolean;
  hasCalendar: boolean;
  myEmails: string;
  anthropicSource: string;
  deepgramSource: string;
}

function useRoute(): [string, (r: string) => void] {
  const [route, setRoute] = useState(location.hash.replace(/^#/, "") || "/");
  useEffect(() => {
    const on = () => setRoute(location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", on);
    const off = cue.on<string>("nav", (r) => (location.hash = r.replace(/^#/, "")));
    return () => {
      window.removeEventListener("hashchange", on);
      off();
    };
  }, []);
  return [route, (r: string) => (location.hash = r)];
}

function useSessions() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const load = useCallback(() => void cue.invoke<SessionRow[]>("sessions:list").then(setSessions), []);
  useEffect(() => {
    load();
    return cue.on("sessions:changed", load);
  }, [load]);
  return sessions;
}

const fmt = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const minutes = (s: SessionRow) => (s.endedAt ? Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000)) : 0);

function SessionList({ sessions, go }: { sessions: SessionRow[]; go: (r: string) => void }) {
  if (!sessions.length) return <div className="empty">No conversations yet. Start one from the overlay, or press <b>Rehearse demo</b> to watch Cue work on a scripted call.</div>;
  return (
    <div className="list">
      {sessions.map((s) => (
        <button key={s.id} className="row" onClick={() => go(`/session/${s.id}`)}>
          <div className="row-main">
            <div className="row-title">{s.title}</div>
            <div className="row-sub">{s.debrief?.summary ? s.debrief.summary.slice(0, 160) : s.debrief === null ? "Debrief pending…" : ""}</div>
          </div>
          <div className="row-meta">
            <div>{ago(s.startedAt)}</div>
            <div className="muted">{minutes(s)} min{s.people.length ? ` · ${s.people.map((p) => p.name.split(" ")[0]).join(", ")}` : ""}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function AskMemory({ go }: { go: (r: string) => void }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<{ text: string; source: string; sessionId: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => cue.on<string>("memory:delta", (t) => setAnswer((a) => a + t)), []);
  const ask = async () => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setAnswer("");
    setSources([]);
    try {
      const r = await cue.invoke<{ answer: string; sources: { text: string; source: string; sessionId: string | null }[] }>("memory:ask", q);
      setAnswer(r.answer);
      setSources(r.sources);
    } catch (e) {
      setAnswer(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  };
  return (
    <div className="panel">
      <div className="panel-title">Ask your memory</div>
      <div className="askrow">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="What did Priya say about their Kafka migration?" />
        <button className="btn primary" onClick={ask} disabled={busy}>{busy ? "…" : "Ask"}</button>
      </div>
      {answer && <div className="answer"><Markdown text={answer} /></div>}
      {sources.length > 0 && (
        <div className="sources">
          {sources.slice(0, 6).map((s, i) => (
            <button key={i} className="source" onClick={() => s.sessionId && go(`/session/${s.sessionId}`)}>
              <span>{s.text.slice(0, 140)}</span>
              <span className="muted">{s.source}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Upcoming {
  uid: string;
  title: string;
  start: number;
  end: number;
  people: string[];
  playbookId: string;
  link: string;
}

function UpcomingPanel({ go }: { go: (r: string) => void }) {
  const [events, setEvents] = useState<Upcoming[] | null>(null);
  const [error, setError] = useState("");
  const [known, setKnown] = useState<Person[]>([]);
  useEffect(() => {
    void cue.invoke<Upcoming[] | { error: string }>("calendar:upcoming").then((r) => (Array.isArray(r) ? setEvents(r) : setError(r.error)));
    void cue.invoke<Person[]>("people:list").then(setKnown);
  }, []);
  if (error) return <div className="panel"><div className="panel-title">Upcoming</div><div className="muted">{error}</div></div>;
  if (!events) return null;
  if (!events.length) return <div className="panel"><div className="panel-title">Upcoming</div><div className="muted">Nothing on your calendar in the next day and a half, or no calendar connected. <button className="link" onClick={() => go("/settings")}>Connect one</button></div></div>;
  const byName = new Map(known.map((p) => [p.name.toLowerCase(), p]));
  return (
    <div className="panel"><div className="panel-title">Upcoming</div>
      {events.map((e) => (
        <div key={`${e.uid}${e.start}`} className="upcoming">
          <div className="up-time">{new Date(e.start).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</div>
          <div className="up-main">
            <div className="row-title">{e.title}</div>
            <div className="up-people">{e.people.map((n) => {
              const p = byName.get(n.toLowerCase());
              return p ? <button key={n} className="chip known" title="Cue remembers this person" onClick={() => go(`/person/${p.id}`)}>{n}</button> : <span key={n} className="chip">{n}</span>;
            })}</div>
          </div>
          <button className="btn" onClick={() => cue.invoke("session:start", { mode: "practice", playbookId: e.playbookId, attendees: e.people, title: e.title })}>Practice</button>
          <button className="btn primary" onClick={() => cue.invoke("session:start", { mode: "live", playbookId: e.playbookId, attendees: e.people, title: e.title })}>Start with Cue</button>
        </div>
      ))}
    </div>
  );
}

function Home({ sessions, go }: { sessions: SessionRow[]; go: (r: string) => void }) {
  const [promises, setPromises] = useState<{ person: Person; fact: Fact }[]>([]);
  useEffect(() => void cue.invoke<{ person: Person; fact: Fact }[]>("promises:list").then(setPromises), [sessions]);
  const recent = sessions.slice(0, 6);
  const total = sessions.reduce((n, s) => n + minutes(s), 0);
  const withStats = sessions.filter((s) => s.stats && s.stats.myWords > 50);
  const avgRatio = withStats.length ? Math.round(withStats.reduce((n, s) => n + s.stats!.talkRatio, 0) / withStats.length * 100) : 0;
  return (
    <div className="page">
      <h1>Today</h1>
      <div className="tiles">
        <div className="tile"><div className="tile-n">{sessions.length}</div><div className="tile-l">conversations</div></div>
        <div className="tile"><div className="tile-n">{total}</div><div className="tile-l">minutes captured</div></div>
        <div className="tile"><div className="tile-n">{avgRatio ? `${avgRatio}%` : "-"}</div><div className="tile-l">avg talk share</div></div>
        <div className="tile"><div className="tile-n">{promises.length}</div><div className="tile-l">promises you made</div></div>
      </div>
      <UpcomingPanel go={go} />
      <AskMemory go={go} />
      {promises.length > 0 && (
        <div className="panel">
          <div className="panel-title">Promises you made</div>
          {promises.slice(0, 8).map((p) => (
            <button key={p.fact.id} className="promise" onClick={() => go(`/person/${p.person.id}`)}>
              <span>{p.fact.text.replace(/^I promised:\s*/, "")}</span>
              <span className="muted">to {p.person.name} · {ago(p.fact.at)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="panel">
        <div className="panel-title">Recent</div>
        <SessionList sessions={recent} go={go} />
      </div>
    </div>
  );
}

function Stat({ n, l, warn }: { n: string | number; l: string; warn?: boolean }) {
  return <div className={`tile small${warn ? " warn" : ""}`}><div className="tile-n">{n}</div><div className="tile-l">{l}</div></div>;
}

function SessionView({ id, go }: { id: string; go: (r: string) => void }) {
  const [s, setS] = useState<SessionDetail | null>(null);
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState("");
  const [filter, setFilter] = useState("");
  const load = useCallback(() => void cue.invoke<SessionDetail | null>("sessions:get", id).then((x) => {
    setS(x);
    if (x?.debrief) setEmail(x.debrief.followUp.body);
  }), [id]);
  useEffect(() => {
    load();
    return cue.on("sessions:changed", load);
  }, [load]);
  if (!s) return <div className="page"><div className="empty">Loading…</div></div>;
  const d = s.debrief;
  const st = s.stats;
  const copy = (key: string, text: string) => {
    void cue.invoke("clipboard:write", text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  };
  const del = async () => {
    await cue.invoke("sessions:delete", id);
    go("/sessions");
  };
  const lines = s.utterances.filter((u) => !filter || u.text.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="page">
      <div className="crumbs"><button className="link" onClick={() => go("/sessions")}>Conversations</button></div>
      <h1>{s.title}</h1>
      <div className="sub">
        {fmt(s.startedAt)} · {minutes(s)} min
        {s.people.map((p) => <button key={p.id} className="chip" onClick={() => go(`/person/${p.id}`)}>{p.name}</button>)}
      </div>
      {!d && <div className="panel"><div className="muted">Debrief is still being written, or failed. The transcript is below.</div></div>}
      {d && (
        <>
          <div className="panel"><div className="panel-title">Summary</div><p>{d.summary}</p>
            {d.decisions.length > 0 && <><div className="panel-sub">Decisions</div><ul>{d.decisions.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          </div>
          {d.actionItems.length > 0 && (
            <div className="panel"><div className="panel-title">Action items</div>
              {d.actionItems.map((a, i) => (
                <div key={i} className="action"><span className={`owner${/^(me|i|you|jonny)$/i.test(a.owner) ? " mine" : ""}`}>{a.owner}</span><span>{a.text}</span>{a.due && <span className="muted">{a.due}</span>}</div>
              ))}
            </div>
          )}
          {d.followUp.body && (
            <div className="panel"><div className="panel-title">Follow-up email <span className="muted">draft, edit before sending</span></div>
              <div className="email-head"><b>To:</b> {d.followUp.to || "-"} &nbsp; <b>Subject:</b> {d.followUp.subject}</div>
              <textarea className="email" value={email} onChange={(e) => setEmail(e.target.value)} rows={Math.min(16, email.split("\n").length + 2)} />
              <div className="btns">
                <button className="btn" onClick={() => copy("email", email)}>{copied === "email" ? "Copied" : "Copy"}</button>
                <button className="btn" onClick={() => cue.invoke("mail:open", d.followUp.to.includes("@") ? d.followUp.to : "", d.followUp.subject, email)}>Open in Mail</button>
              </div>
            </div>
          )}
          <div className="panel"><div className="panel-title">Coaching</div>
            {st && (
              <div className="tiles">
                <Stat n={`${Math.round(st.talkRatio * 100)}%`} l="your talk share" warn={st.talkRatio > 0.65} />
                <Stat n={st.wpm || "-"} l="words / min" warn={st.wpm > 180} />
                <Stat n={st.fillers} l="filler words" warn={st.fillerRate > 4} />
                <Stat n={`${st.longestMonologue}s`} l="longest monologue" warn={st.longestMonologue > 90} />
                <Stat n={st.questionsAsked} l="questions you asked" />
              </div>
            )}
            <div className="two">
              <div><div className="panel-sub">Worked</div><ul>{d.coaching.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              <div><div className="panel-sub">Next time</div><ul>{d.coaching.improve.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            </div>
            {d.coaching.moments.length > 0 && <><div className="panel-sub">Moments</div>{d.coaching.moments.map((m, i) => <div key={i} className="moment"><q>{m.quote}</q><span>{m.note}</span></div>)}</>}
          </div>
          {d.people.length > 0 && (
            <div className="panel"><div className="panel-title">Remembered for next time</div>
              {d.people.map((p) => (
                <div key={p.name} className="remember"><b>{p.name}</b>{p.role || p.org ? <span className="muted"> {[p.role, p.org].filter(Boolean).join(", ")}</span> : null}<ul>{p.facts.map((f, i) => <li key={i}>{f}</li>)}</ul></div>
              ))}
            </div>
          )}
        </>
      )}
      {s.cards.length > 0 && (
        <div className="panel"><div className="panel-title">What Cue showed you</div>
          <div className="cardgrid">
            {s.cards.map((c) => (
              <div key={c.id} className={`card mini kind-${c.kind}`}><div className="card-head"><span className="tag">{KIND_LABEL[c.kind] ?? c.kind}</span><span className="card-title">{c.title}</span></div><Markdown text={c.body} /></div>
            ))}
          </div>
        </div>
      )}
      <div className="panel"><div className="panel-title">Transcript <input className="filter" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <div className="full-transcript">
          {lines.map((u) => <div key={u.id} className={`line ${u.speaker}`}><span className="who">{u.speaker === "me" ? "Me" : "Them"}</span><span className="when">{new Date(u.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span><span>{u.text}</span></div>)}
        </div>
        <div className="btns"><button className="btn" onClick={() => copy("t", s.utterances.map((u) => `${u.speaker === "me" ? "Me" : "Them"}: ${u.text}`).join("\n"))}>{copied === "t" ? "Copied" : "Copy transcript"}</button><button className="btn danger" onClick={del}>Delete conversation</button></div>
      </div>
    </div>
  );
}

function People({ go }: { go: (r: string) => void }) {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const load = () => void cue.invoke<PersonRow[]>("people:list").then(setPeople);
  useEffect(load, []);
  const add = async () => {
    if (!name.trim()) return;
    await cue.invoke("people:save", { id: "", name, org: "", role: "", notes: "", lastSeen: 0 });
    setName("");
    load();
  };
  const shown = people.filter((p) => !q || `${p.name} ${p.org} ${p.role}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <h1>People</h1>
      <p className="lede">Everyone Cue has met with you. What it remembers about them shows up as a card the moment they come up in a call.</p>
      <div className="askrow"><input placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} /><input placeholder="Add someone by name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /><button className="btn" onClick={add}>Add</button></div>
      {!shown.length && <div className="empty">No people yet. They're added automatically after each call.</div>}
      <div className="list">
        {shown.map((p) => (
          <button key={p.id} className="row" onClick={() => go(`/person/${p.id}`)}>
            <div className="avatar">{p.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</div>
            <div className="row-main"><div className="row-title">{p.name}</div><div className="row-sub">{[p.role, p.org].filter(Boolean).join(", ") || "-"}</div></div>
            <div className="row-meta"><div>{p.factCount} notes</div><div className="muted">{p.sessionCount} calls{p.lastSeen ? ` · ${ago(p.lastSeen)}` : ""}</div></div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PersonView({ id, go }: { id: string; go: (r: string) => void }) {
  const [p, setP] = useState<PersonDetail | null>(null);
  const [fact, setFact] = useState("");
  const [dirty, setDirty] = useState(false);
  const load = useCallback(() => void cue.invoke<PersonDetail | null>("people:get", id).then((x) => {
    setP(x);
    setDirty(false);
  }), [id]);
  useEffect(load, [load]);
  if (!p) return <div className="page"><div className="empty">Not found.</div></div>;
  const field = (k: "name" | "org" | "role" | "notes", label: string, multi = false) => (
    <label className="field"><span>{label}</span>{multi
      ? <textarea rows={3} value={p[k]} onChange={(e) => { setP({ ...p, [k]: e.target.value }); setDirty(true); }} />
      : <input value={p[k]} onChange={(e) => { setP({ ...p, [k]: e.target.value }); setDirty(true); }} />}</label>
  );
  const save = async () => {
    await cue.invoke("people:save", { id: p.id, name: p.name, org: p.org, role: p.role, notes: p.notes, lastSeen: p.lastSeen });
    setDirty(false);
  };
  const addFact = async () => {
    if (!fact.trim()) return;
    await cue.invoke("facts:add", p.id, fact);
    setFact("");
    load();
  };
  return (
    <div className="page">
      <div className="crumbs"><button className="link" onClick={() => go("/people")}>People</button></div>
      <h1>{p.name}</h1>
      <div className="panel">
        <div className="grid2">{field("name", "Name")}{field("org", "Company")}{field("role", "Role")}</div>
        {field("notes", "Notes", true)}
        <div className="btns"><button className="btn primary" disabled={!dirty} onClick={save}>Save</button><button className="btn danger" onClick={async () => { await cue.invoke("people:delete", p.id); go("/people"); }}>Forget this person</button></div>
      </div>
      <div className="panel"><div className="panel-title">What Cue remembers</div>
        {p.facts.map((f) => (
          <div key={f.id} className={`fact${f.text.startsWith("I promised") ? " promise-fact" : ""}`}><span>{f.text}</span><span className="muted">{ago(f.at)}</span><button className="icon" onClick={async () => { await cue.invoke("facts:delete", f.id); load(); }}>×</button></div>
        ))}
        <div className="askrow"><input placeholder="Add something to remember" value={fact} onChange={(e) => setFact(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addFact()} /><button className="btn" onClick={addFact}>Add</button></div>
      </div>
      <div className="panel"><div className="panel-title">Conversations</div><SessionList sessions={p.sessions} go={go} /></div>
    </div>
  );
}

const KINDS = ["interview", "sales", "meeting", "lecture", "networking", "negotiation", "other"];

function Playbooks() {
  const [list, setList] = useState<Playbook[]>([]);
  const [sel, setSel] = useState<Playbook | null>(null);
  const [saved, setSaved] = useState(false);
  const load = (pick?: string) => void cue.invoke<Playbook[]>("playbooks:list").then((l) => {
    setList(l);
    setSel((s) => l.find((x) => x.id === (pick ?? s?.id)) ?? l[0] ?? null);
  });
  useEffect(() => load(), []);
  const save = async () => {
    if (!sel) return;
    const p = await cue.invoke<Playbook>("playbooks:save", sel);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
    load(p.id);
  };
  const create = () => setSel({ id: "", name: "New playbook", kind: "meeting", instructions: "", context: "", builtin: false });
  return (
    <div className="page wide">
      <h1>Playbooks</h1>
      <p className="lede">A playbook tells Cue what kind of conversation this is and who you are. Paste your resume, your product one-pager or your talking points into <b>Your background</b>: Cue only uses facts you give it.</p>
      <div className="split">
        <div className="side-list">
          {list.map((p) => <button key={p.id} className={`side-item${sel?.id === p.id ? " on" : ""}`} onClick={() => setSel(p)}>{p.name}{p.context.trim() ? <span className="dotmark" title="Has background" /> : null}</button>)}
          <button className="side-item add" onClick={create}>+ New playbook</button>
        </div>
        {sel && (
          <div className="panel grow">
            <div className="grid2">
              <label className="field"><span>Name</span><input value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })} /></label>
              <label className="field"><span>Type</span><select value={sel.kind} onChange={(e) => setSel({ ...sel, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
            </div>
            <label className="field"><span>How Cue should help</span><textarea rows={8} value={sel.instructions} onChange={(e) => setSel({ ...sel, instructions: e.target.value })} /></label>
            <label className="field"><span>Your background <span className="muted">(resume, product facts, talking points)</span></span><textarea rows={12} value={sel.context} onChange={(e) => setSel({ ...sel, context: e.target.value })} placeholder={"- Interned at Abridge on the clinical notes streaming pipeline...\n- Built ..."} /></label>
            <div className="btns"><button className="btn primary" onClick={save}>{saved ? "Saved" : "Save"}</button>{!sel.builtin && sel.id && <button className="btn danger" onClick={async () => { await cue.invoke("playbooks:delete", sel.id); setSel(null); load(); }}>Delete</button>}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsView() {
  const [s, setS] = useState<Settings | null>(null);
  const [ak, setAk] = useState("");
  const [dk, setDk] = useState("");
  const [cal, setCal] = useState("");
  const [wipe, setWipe] = useState(false);
  useEffect(() => {
    void cue.invoke<Settings>("settings:get").then(setS);
    return cue.on<Settings>("settings:changed", setS);
  }, []);
  if (!s) return null;
  const set = async (patch: Record<string, unknown>) => setS(await cue.invoke<Settings>("settings:set", patch));
  const toggle = (k: keyof Settings, label: string, hint: string) => (
    <label className="toggle-row"><input type="checkbox" checked={!!s[k]} onChange={(e) => set({ [k]: e.target.checked })} /><span><b>{label}</b><span className="muted">{hint}</span></span></label>
  );
  const src = (x: string) => (x === "settings" ? "saved here" : x === "env" ? "from .env" : "missing");
  return (
    <div className="page">
      <h1>Settings</h1>
      <div className="panel"><div className="panel-title">Keys <span className="muted">stored encrypted in your macOS keychain-backed storage</span></div>
        <label className="field"><span>Claude API key <span className={`pill ${s.hasAnthropic ? "ok" : "bad"}`}>{src(s.anthropicSource)}</span></span>
          <div className="askrow"><input type="password" placeholder="sk-ant-…" value={ak} onChange={(e) => setAk(e.target.value)} /><button className="btn" onClick={() => { void set({ anthropicKey: ak }); setAk(""); }}>Save</button></div></label>
        <label className="field"><span>Deepgram API key <span className={`pill ${s.hasDeepgram ? "ok" : "bad"}`}>{src(s.deepgramSource)}</span> <span className="muted">live transcription</span></span>
          <div className="askrow"><input type="password" placeholder="Deepgram key" value={dk} onChange={(e) => setDk(e.target.value)} /><button className="btn" onClick={() => { void set({ deepgramKey: dk }); setDk(""); }}>Save</button></div></label>
        <div className="grid2">
          <label className="field"><span>Model</span><input value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} onBlur={() => set({ model: s.model })} /></label>
          <label className="field"><span>Live effort <span className="muted">lower is faster</span></span><select value={s.liveEffort} onChange={(e) => set({ liveEffort: e.target.value })}>{["low", "medium", "high"].map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
      </div>
      <div className="panel"><div className="panel-title">Calendar <span className={`pill ${s.hasCalendar ? "ok" : "bad"}`}>{s.hasCalendar ? "connected" : "not connected"}</span></div>
        <p className="muted">Paste your calendar's secret iCal address (Google Calendar: Settings &gt; your calendar &gt; Integrate calendar &gt; Secret address in iCal format). Cue reads it to show what's next and who's on each call. Read-only, stored encrypted.</p>
        <div className="askrow"><input type="password" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={cal} onChange={(e) => setCal(e.target.value)} /><button className="btn" onClick={() => { void set({ calendarUrl: cal }); setCal(""); }}>Save</button></div>
        <label className="field"><span>Your email addresses <span className="muted">so you aren't listed as an attendee</span></span><input value={s.myEmails} onChange={(e) => setS({ ...s, myEmails: e.target.value })} onBlur={() => set({ myEmails: s.myEmails })} placeholder="you@gmail.com, you@school.edu" /></label>
      </div>
      <div className="panel"><div className="panel-title">During calls</div>
        {toggle("autoSuggest", "Suggest when they ask you something", "Cue drafts what to say as soon as the other side finishes a question.")}
        {toggle("insights", "Live cards", "Definitions, fact checks and openings, a few at most, never repeated.")}
        {toggle("coach", "Coach", "Talk share, pace and filler words, with a nudge when something drifts.")}
        {toggle("screenshotOnAsk", "Look at my screen on ⌘↵", "Attach a screenshot to manual asks.")}
      </div>
      <div className="panel"><div className="panel-title">Privacy</div>
        {toggle("stealth", "Hide the overlay from screen sharing", "Best effort: works against most window-level capture, not guaranteed against every recorder. Off by default. Tell people when you're using an assistant.")}
        <p className="muted">Everything is stored locally in a SQLite file on this Mac. Card numbers, SSNs, passwords and API keys are redacted before anything is sent to Claude.</p>
        {!wipe ? <button className="btn danger" onClick={() => setWipe(true)}>Delete all conversations and people…</button> : <div className="btns"><span>This can't be undone.</span><button className="btn danger" onClick={async () => { await cue.invoke("data:wipe"); setWipe(false); }}>Delete everything</button><button className="btn" onClick={() => setWipe(false)}>Cancel</button></div>}
      </div>
      <div className="panel"><div className="panel-title">Shortcuts</div>
        <div className="shortcuts">
          {[["⌘↵", "Answer using screen + conversation"], ["⌘⇧↵", "What should I say (conversation only)"], ["⌘\\", "Show / hide overlay"], ["⌘⇧L", "Start / end a call"], ["⌘⇧M", "Click-through overlay"], ["⌘⇧K", "Clear cards"], ["⌘⇧D", "Open dashboard"], ["⌥⌘ arrows", "Move overlay"]].map(([k, v]) => <div key={k}><kbd>{k}</kbd><span>{v}</span></div>)}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [route, go] = useRoute();
  const sessions = useSessions();
  const nav = [["/", "Today"], ["/sessions", "Conversations"], ["/people", "People"], ["/playbooks", "Playbooks"], ["/settings", "Settings"]];
  const [, section, arg] = route.split("/");
  const activeNav = section === "session" ? "/sessions" : section === "person" ? "/people" : `/${section ?? ""}`;
  return (
    <div className="dash">
      <nav className="sidebar">
        <div className="brand"><span className="dot live" />Cue</div>
        {nav.map(([r, l]) => <button key={r} className={`nav${activeNav === r ? " on" : ""}`} onClick={() => go(r)}>{l}</button>)}
        <div className="spacer" />
        <button className="btn primary block" onClick={() => cue.invoke("session:start", { mode: "rehearsal", playbookId: "interview", attendees: [] })}>Rehearse demo</button>
      </nav>
      <main>
        {section === "" || section === undefined ? <Home sessions={sessions} go={go} /> : null}
        {section === "sessions" && <div className="page"><h1>Conversations</h1><SessionList sessions={sessions} go={go} /></div>}
        {section === "session" && arg && <SessionView key={arg} id={arg} go={go} />}
        {section === "people" && <People go={go} />}
        {section === "person" && arg && <PersonView key={arg} id={arg} go={go} />}
        {section === "playbooks" && <Playbooks />}
        {section === "settings" && <SettingsView />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
