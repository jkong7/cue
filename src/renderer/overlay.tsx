import { createRoot } from "react-dom/client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cue, Markdown, KIND_LABEL, clock } from "./shared.tsx";
import type { Card, CoachStats, Person, Playbook, Utterance } from "../engine/types.ts";

interface Started {
  mode: "live" | "practice" | "rehearsal" | "adhoc";
  title: string;
  playbook: Playbook | null;
  attendees: Person[];
  brain: string;
  stealth: boolean;
}

function useMic(active: boolean) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!active) return;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        ctx = new AudioContext({ sampleRate: 16000 });
        await ctx.audioWorklet.addModule("pcm-worklet.js");
        const src = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "pcm");
        node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
          cue.sendPcm(e.data.pcm);
          setLevel(e.data.level);
        };
        src.connect(node);
        setError("");
      } catch (e) {
        setError(`Microphone unavailable: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      setLevel(0);
    };
  }, [active]);
  return { level, error };
}

function Meter({ level, label }: { level: number; label: string }) {
  const w = Math.min(100, Math.round(Math.sqrt(level) * 220));
  return (
    <span className="meter" title={label}>
      <span className="meter-label">{label}</span>
      <span className="meter-track"><span className="meter-fill" style={{ width: `${w}%` }} /></span>
    </span>
  );
}

function CoachStrip({ s }: { s: CoachStats }) {
  const pct = Math.round(s.talkRatio * 100);
  return (
    <div className="coach">
      <div className="ratio" title="Share of the talking that is you">
        <span className="ratio-me" style={{ width: `${pct}%` }} />
      </div>
      <span>You {pct}%</span>
      <span>{s.wpm || "-"} wpm</span>
      <span>{s.fillers} fillers</span>
      {s.currentMonologue > 30 && <span className="warn">{s.currentMonologue}s monologue</span>}
    </div>
  );
}

function CardView({ c, onDismiss, primary }: { c: Card; onDismiss: () => void; primary: boolean }) {
  return (
    <div className={`card kind-${c.kind}${primary ? " primary" : ""}${c.done ? "" : " streaming"}`}>
      <div className="card-head">
        <span className="tag">{KIND_LABEL[c.kind] ?? c.kind}</span>
        {c.title !== KIND_LABEL[c.kind] && <span className="card-title">{c.title}</span>}
        <span className="spacer" />
        {c.done && c.body && <button className="icon" title="Copy" onClick={() => cue.invoke("clipboard:write", c.body)}>⧉</button>}
        <button className="icon" title="Dismiss" onClick={onDismiss}>×</button>
      </div>
      {c.trigger && (c.kind === "suggest" || c.kind === "answer") && <div className="trigger">“{c.trigger.slice(0, 140)}”</div>}
      {c.body ? <Markdown text={c.body} /> : <div className="thinking"><span /><span /><span /></div>}
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

const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function StartPanel({ onStart, rehearse }: { onStart: (mode: "live" | "practice" | "rehearsal", playbookId: string, attendees: string[], title?: string) => void; rehearse: boolean }) {
  const [events, setEvents] = useState<Upcoming[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [pb, setPb] = useState("interview");
  const [who, setWho] = useState("");
  const [settings, setSettings] = useState<{ hasAnthropic: boolean; hasDeepgram: boolean } | null>(null);
  useEffect(() => {
    void cue.invoke<Playbook[]>("playbooks:list").then(setPlaybooks);
    void cue.invoke<Person[]>("people:list").then(setPeople);
    void cue.invoke<{ hasAnthropic: boolean; hasDeepgram: boolean }>("settings:get").then(setSettings);
    void cue.invoke<Upcoming[] | { error: string }>("calendar:upcoming").then((e) => Array.isArray(e) && setEvents(e.filter((x) => x.end > Date.now()).slice(0, 3)));
  }, []);
  const names = who.split(",").map((s) => s.trim()).filter(Boolean);
  const lastTyped = who.split(",").pop()?.trim().toLowerCase() ?? "";
  const suggestions = lastTyped.length >= 1 ? people.filter((p) => p.name.toLowerCase().includes(lastTyped) && !names.includes(p.name)).slice(0, 4) : [];
  const pick = (name: string) => setWho([...who.split(",").slice(0, -1).map((s) => s.trim()).filter(Boolean), name].join(", ") + ", ");
  return (
    <div className="start">
      {events.length > 0 && (
        <>
          <label>Up next</label>
          {events.map((e) => (
            <button key={`${e.uid}${e.start}`} className="event" onClick={() => onStart("live", e.playbookId, e.people, e.title)}>
              <span className="event-time">{e.start <= Date.now() ? "now" : hhmm(e.start)}</span>
              <span className="event-title">{e.title}</span>
              <span className="muted">{e.people.slice(0, 3).join(", ")}</span>
            </button>
          ))}
        </>
      )}
      <label>Playbook</label>
      <div className="chips">
        {playbooks.map((p) => (
          <button key={p.id} className={`chip${p.id === pb ? " on" : ""}`} onClick={() => setPb(p.id)}>{p.name}</button>
        ))}
      </div>
      <label>Who's on the call <span className="muted">(optional, comma separated)</span></label>
      <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Priya Raman, Marcus Webb" />
      {suggestions.length > 0 && (
        <div className="suggest-people">
          {suggestions.map((p) => <button key={p.id} className="chip" onClick={() => pick(p.name)}>{p.name}{p.org ? ` · ${p.org}` : ""}</button>)}
        </div>
      )}
      <div className="start-actions">
        <button className="btn primary" onClick={() => onStart("live", pb, names)} title="⌘⇧L">Start listening</button>
        <button className="btn" onClick={() => onStart("practice", pb, names)}>Practice</button>
        <button className={`btn${rehearse ? " pulse" : ""}`} onClick={() => onStart("rehearsal", pb, names)}>Rehearse demo</button>
      </div>
      {settings && (!settings.hasAnthropic || !settings.hasDeepgram) && (
        <div className="hint">
          {!settings.hasAnthropic && <div>No Claude key yet: answers run in rehearsal mode.</div>}
          {!settings.hasDeepgram && <div>No Deepgram key yet: live transcription is off.</div>}
          <button className="link" onClick={() => cue.invoke("dashboard:open", "#/settings")}>Add keys in Settings</button>
        </div>
      )}
      <div className="keys">
        <span><kbd>⌘↵</kbd> answer from screen</span>
        <span><kbd>⌘⇧↵</kbd> what to say</span>
        <span><kbd>⌘\</kbd> hide</span>
        <span><kbd>⌘⇧M</kbd> click-through</span>
      </div>
    </div>
  );
}

function App() {
  const [started, setStarted] = useState<Started | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [utts, setUtts] = useState<Utterance[]>([]);
  const [stats, setStats] = useState<CoachStats | null>(null);
  const [capture, setCapture] = useState<{ mic: boolean; system: boolean; script?: boolean }>({ mic: false, system: false });
  const [themLevel, setThemLevel] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [q, setQ] = useState("");
  const [withScreen, setWithScreen] = useState(false);
  const [t0, setT0] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [turn, setTurn] = useState<string>("");
  const [status, setStatus] = useState("");
  const [clickThrough, setClickThrough] = useState(false);
  const [rehearse, setRehearse] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const mic = useMic(capture.mic);

  useEffect(() => {
    const offs = [
      cue.on<Started>("live:started", (s) => {
        setStarted(s);
        setCards([]);
        setUtts([]);
        setStats(null);
        setErrors([]);
        setT0(Date.now());
        setStatus("");
        setShowStart(false);
      }),
      cue.on<{ debriefing?: boolean }>("live:stopped", (p) => {
        setStarted(null);
        setTurn("");
        setStatus(p?.debriefing ? "Writing your debrief…" : "");
      }),
      cue.on("live:debriefed", () => setStatus("Debrief ready in the dashboard.")),
      cue.on<Card>("live:card", (c) => setCards((cs) => [...cs.filter((x) => x.id !== c.id), c])),
      cue.on<{ id: string; text: string }>("live:delta", (d) => setCards((cs) => cs.map((c) => (c.id === d.id ? { ...c, body: c.body + d.text } : c)))),
      cue.on<Card>("live:done", (c) => setCards((cs) => (cs.some((x) => x.id === c.id) ? cs.map((x) => (x.id === c.id ? { ...c } : x)) : [...cs, c]))),
      cue.on<Utterance>("live:utterance", (u) => setUtts((us) => {
        const i = us.findIndex((x) => x.id === u.id);
        if (i >= 0) return us.map((x, j) => (j === i ? u : x));
        return [...us.filter((x) => !(x.id === "practice-live" && u.speaker === "me" && u.final)), u].slice(-200);
      })),
      cue.on<string>("live:drop", (id) => setUtts((us) => us.filter((u) => u.id !== id))),
      cue.on<CoachStats>("live:stats", setStats),
      cue.on<{ mic: boolean; system: boolean; script?: boolean }>("live:capture", setCapture),
      cue.on<{ level: number }>("live:level", (l) => setThemLevel(l.level)),
      cue.on<string>("live:error", (e) => setErrors((es) => [...es.filter((x) => x !== e), e].slice(-3))),
      cue.on<string>("live:turn", setTurn),
      cue.on<boolean>("ui:clickthrough", setClickThrough),
      cue.on("ui:clear", () => setCards([])),
      cue.on<{ rehearse?: boolean } | undefined>("ui:start", (p) => {
        setShowStart(true);
        if (p?.rehearse) setRehearse(true);
      }),
    ];
    void cue.invoke<{ active: boolean; meta: { title: string; mode: Started["mode"] } | null; utterances: Utterance[]; cards: Card[] }>("session:state").then((s) => {
      if (s.active && s.meta) {
        setStarted({ mode: s.meta.mode, title: s.meta.title, playbook: null, attendees: [], brain: "", stealth: false });
        setUtts(s.utterances);
        setCards(s.cards);
      }
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      offs.forEach((o) => o());
      clearInterval(tick);
    };
  }, []);

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const ro = new ResizeObserver(() => void cue.invoke("overlay:resize", (rootRef.current?.scrollHeight ?? 400) + 4));
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [utts, showTranscript]);

  const start = (mode: "live" | "practice" | "rehearsal", playbookId: string, attendees: string[], title?: string) => {
    setRehearse(false);
    void cue.invoke("session:start", { mode, playbookId, attendees, title });
  };
  const stop = () => void cue.invoke("session:stop", true);
  const ask = () => {
    if (started?.mode === "practice") {
      if (q.trim()) void cue.invoke("practice:answer", q.trim());
    } else void cue.invoke("assist", "answer", q.trim() || undefined, withScreen || !q.trim());
    setQ("");
  };

  const active = !!started && started.mode !== "adhoc";
  const ordered = [...cards].reverse();
  const primaryId = ordered.find((c) => c.kind === "suggest" || c.kind === "answer")?.id;
  const visibleUtts = showTranscript ? utts : utts.slice(-2);
  const allErrors = [...errors, ...(mic.error ? [mic.error] : [])];

  return (
    <div ref={rootRef} className={`overlay${clickThrough ? " ghost" : ""}`}>
      <div className="bar">
        <span className={`dot${active ? " live" : ""}`} />
        <span className="title">{started ? started.title : "Cue"}</span>
        {active && <span className="timer">{clock(now - t0)}</span>}
        {started?.brain === "rehearsal" && <span className="badge" title="No Claude key: canned answers">rehearsal</span>}
        {started?.stealth && <span className="badge stealth" title="Hidden from screen share (best effort)">hidden</span>}
        <span className="spacer" />
        {capture.mic && <Meter level={mic.level} label="me" />}
        {capture.system && <Meter level={themLevel} label="them" />}
        {capture.script && <span className="badge">scripted call</span>}
        {active ? <button className="btn small danger" onClick={stop}>End</button> : <button className="btn small" onClick={() => setShowStart((s) => !s)}>{showStart ? "Close" : "Start"}</button>}
        <button className="icon" title="Dashboard (⌘⇧D)" onClick={() => cue.invoke("dashboard:open")}>▤</button>
        <button className="icon" title="Hide (⌘\)" onClick={() => cue.invoke("overlay:hide")}>–</button>
      </div>

      {!active && showStart && <StartPanel onStart={start} rehearse={rehearse} />}
      {!active && !showStart && !cards.length && (
        <div className="idle">
          <div className="idle-line">Press <kbd>⌘↵</kbd> for an answer about your screen, or <button className="link" onClick={() => setShowStart(true)}>start a call</button>.</div>
          {status && <div className="status">{status}</div>}
        </div>
      )}
      {status && (active || cards.length > 0) && <div className="status">{status}</div>}

      {allErrors.map((e) => (
        <div key={e} className="error" onClick={() => setErrors((es) => es.filter((x) => x !== e))}>{e}</div>
      ))}

      {stats && active && started?.mode !== "practice" && <CoachStrip s={stats} />}
      {started?.mode === "practice" && turn && <div className="turn">{turn === "listening" ? "Your turn. Answer out loud; pause 2.5s when done." : turn === "grading" ? "Grading your answer…" : "Thinking of a question…"}{turn === "listening" && <button className="link" onClick={() => cue.invoke("practice:submit")}>Done</button>}</div>}

      <div className="cards">
        {ordered.slice(0, 12).map((c) => (
          <CardView key={c.id} c={c} primary={c.id === primaryId} onDismiss={() => setCards((cs) => cs.filter((x) => x.id !== c.id))} />
        ))}
      </div>

      {(active || utts.length > 0) && (
        <div className="transcript-wrap">
          <button className="transcript-toggle" onClick={() => setShowTranscript((s) => !s)}>{showTranscript ? "▾ Transcript" : "▸ Transcript"} <span className="muted">{utts.length}</span></button>
          <div ref={transcriptRef} className={`transcript${showTranscript ? " open" : ""}`}>
            {visibleUtts.map((u) => (
              <div key={u.id} className={`line ${u.speaker}${u.final ? "" : " partial"}`}><b>{u.speaker === "me" ? "Me" : "Them"}</b> {u.text}</div>
            ))}
          </div>
        </div>
      )}

      <div className="ask">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder={started?.mode === "practice" ? "Answer out loud, or type it here…" : active ? "Ask about this call…" : "Ask anything about your screen…"} />
        <button className={`icon toggle${withScreen ? " on" : ""}`} title="Include a screenshot" onClick={() => setWithScreen((s) => !s)}>◱</button>
        <button className="btn small primary" onClick={ask}>Ask</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
