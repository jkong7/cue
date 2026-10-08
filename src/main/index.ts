import { app, BrowserWindow, Menu, Tray, nativeImage, desktopCapturer, globalShortcut, ipcMain, screen, session as electronSession, shell, clipboard, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store } from "../engine/store.ts";
import { LiveSession } from "../engine/session.ts";
import { PracticeSession } from "../engine/practice.ts";
import { ClaudeBrain } from "../engine/claude.ts";
import { RehearsalBrain } from "../engine/rehearsal.ts";
import { DeepgramStream, ScriptPlayer, type SttStream } from "../engine/stt.ts";
import { SCRIPTS } from "../engine/scripts.ts";
import { BRIEF_SYSTEM, MEMORY_SYSTEM, buildContext } from "../engine/prompts.ts";
import type { Brain, Person, SpeechEvent } from "../engine/types.ts";
import { SystemAudio } from "./audio.ts";
import { displayName, guessPlaybook, parseIcs, type CalEvent } from "../engine/calendar.ts";
import { loadEnvFile, publicSettings, readSettings, writeSettings, type Settings } from "./config.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = app.getAppPath();
loadEnvFile(root);
if (process.env.CUE_USER_DATA) app.setPath("userData", process.env.CUE_USER_DATA);

let store: Store;
let overlay: BrowserWindow | null = null;
let dashboard: BrowserWindow | null = null;
let live: LiveSession | null = null;
let practice: PracticeSession | null = null;
let player: ScriptPlayer | null = null;
let streams: Partial<Record<"me" | "them", SttStream>> = {};
let sysAudio: SystemAudio | null = null;
let clickThrough = false;
let tray: Tray | null = null;
let liveMeta: { playbookId: string; attendees: Person[]; mode: string; title: string } | null = null;

const settings = () => readSettings(store);

function brain(): Brain {
  const s = settings();
  if (process.env.CUE_REHEARSAL === "1" || !s.anthropicKey) return new RehearsalBrain();
  return new ClaudeBrain({ apiKey: s.anthropicKey, model: s.model, liveEffort: s.liveEffort });
}

const send = (channel: string, payload?: unknown) => {
  for (const w of [overlay, dashboard]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
};

function createOverlay() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 460;
  overlay = new BrowserWindow({
    width,
    height: 620,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 360,
    minHeight: 160,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    type: "panel",
    show: false,
    title: "Cue",
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setContentProtection(settings().stealth);
  overlay.loadFile(join(here, "overlay.html"));
  overlay.once("ready-to-show", () => !process.env.CUE_SNAPSHOT_DIR && overlay?.showInactive());
  overlay.on("closed", () => (overlay = null));
}

function createDashboard(route?: string) {
  if (dashboard && !dashboard.isDestroyed()) {
    dashboard.show();
    dashboard.focus();
    if (route) dashboard.webContents.send("nav", route);
    return;
  }
  dashboard = new BrowserWindow({
    show: !process.env.CUE_SNAPSHOT_DIR,
    width: 1180,
    height: 800,
    minWidth: 820,
    minHeight: 560,
    title: "Cue",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f1115",
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: false },
  });
  dashboard.loadFile(join(here, "dashboard.html"), route ? { hash: route } : undefined);
  dashboard.on("closed", () => (dashboard = null));
}

function toggleOverlay() {
  if (!overlay) return createOverlay();
  if (overlay.isVisible()) overlay.hide();
  else {
    overlay.showInactive();
    overlay.setContentProtection(settings().stealth);
  }
}

async function captureScreen(): Promise<string> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const scale = Math.min(1, 1568 / Math.max(display.size.width, display.size.height));
  const thumbnailSize = { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) };
  const hide = overlay && overlay.isVisible() && !settings().stealth;
  if (hide) overlay!.setOpacity(0);
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error("Screen capture returned nothing. Grant Screen Recording permission in System Settings.");
    return src.thumbnail.toPNG().toString("base64");
  } finally {
    if (hide) overlay!.setOpacity(1);
  }
}

function wire(target: LiveSession | PracticeSession) {
  target.on("utterance", (u) => send("live:utterance", u));
  target.on("card", (c) => send("live:card", c));
  target.on("card:delta", (d) => send("live:delta", d));
  target.on("card:done", (c) => send("live:done", c));
  target.on("error", (e) => send("live:error", e));
  if (target instanceof LiveSession) {
    target.on("stats", (s) => send("live:stats", s));
    target.on("drop", (id) => send("live:drop", id));
  } else {
    target.on("turn", (t) => send("live:turn", t));
  }
}

const ingest = (ev: SpeechEvent) => {
  live?.ingest(ev);
  practice?.ingest(ev);
};

function startStt(withSystem: boolean) {
  const s = settings();
  if (!s.deepgramKey) {
    send("live:error", "No Deepgram key, so live transcription is off. Add one in Settings, or try Rehearse to see Cue run on a scripted call.");
    return;
  }
  const t0 = Date.now();
  const keyterms = liveMeta?.attendees.flatMap((p) => [p.name, p.org].filter(Boolean)) ?? [];
  const speakers: ("me" | "them")[] = withSystem ? ["me", "them"] : ["me"];
  for (const speaker of speakers) {
    const st = new DeepgramStream({ apiKey: s.deepgramKey, speaker, t0, keyterms });
    st.on("speech", ingest);
    st.on("error", (e) => send("live:error", e));
    streams[speaker] = st;
  }
  if (withSystem) {
    sysAudio = new SystemAudio(join(root, "bin", "cue-audio"));
    sysAudio.on("pcm", (b) => streams.them?.write(b));
    sysAudio.on("level", (l) => send("live:level", { speaker: "them", level: l }));
    sysAudio.on("error", (e) => send("live:error", e));
    sysAudio.start();
  }
  send("live:capture", { mic: true, system: withSystem });
}

function stopCapture() {
  for (const st of Object.values(streams)) st?.close();
  streams = {};
  sysAudio?.stop();
  sysAudio = null;
  player?.stop();
  player = null;
  send("live:capture", { mic: false, system: false });
}

interface StartOpts {
  mode: "live" | "practice" | "rehearsal";
  playbookId: string;
  attendees: string[];
  title?: string;
  script?: string;
}

async function startSession(opts: StartOpts) {
  if (live || practice) await stopSession(false);
  const s = settings();
  const pb = store.playbook(opts.playbookId);
  const script = opts.mode === "rehearsal" ? SCRIPTS[opts.script ?? (pb?.kind === "sales" ? "sales" : "interview")] ?? SCRIPTS.interview : null;
  const names = opts.attendees.map((a) => a.trim()).filter(Boolean);
  const attendees = names.map((n) => store.personByName(n) ?? { id: `new:${n}`, name: n, org: "", role: "", notes: "", lastSeen: 0 });
  const title = opts.title || script?.title || (names.length ? `${pb?.name ?? "Call"} with ${names.join(", ")}` : pb?.name ?? "Conversation");
  liveMeta = { playbookId: opts.playbookId, attendees, mode: opts.mode, title };
  const b = opts.mode === "rehearsal" && !s.anthropicKey ? new RehearsalBrain() : brain();
  send("live:started", { mode: opts.mode, title, playbook: pb, attendees, brain: b.name, stealth: s.stealth });
  setTimeout(refreshTray, 0);
  if (opts.mode === "practice") {
    practice = new PracticeSession({ brain: b, playbook: pb });
    wire(practice);
    startStt(false);
    void practice.ask();
    return;
  }
  live = new LiveSession({ brain: b, memory: store, playbook: pb, attendees: attendees.filter((p) => !p.id.startsWith("new:")), autoSuggest: s.autoSuggest, insights: s.insights, coach: s.coach });
  wire(live);
  const known = attendees.filter((p) => !p.id.startsWith("new:"));
  if (known.length) void brief(known, opts.playbookId);
  if (script) {
    player = new ScriptPlayer(script.lines, Number(process.env.CUE_SCRIPT_SPEED ?? 1));
    player.on("speech", ingest);
    player.start();
    send("live:capture", { mic: false, system: false, script: true });
  } else startStt(true);
}

async function brief(people: Person[], playbookId: string) {
  if (!live) return;
  const target = live;
  const promises = store.openPromises().filter((p) => people.some((x) => x.id === p.person.id));
  const card = target.addCard("brief", `Brief: ${people.map((p) => p.name).join(", ")}`, "", false);
  const pb = store.playbook(playbookId);
  const context = buildContext(pb, people, (id) => store.factsFor(id));
  const past = people.flatMap((p) => store.sessionsWith(p.id).slice(0, 3)).map((s) => `- ${s.title} (${new Date(s.startedAt).toDateString()}): ${s.debrief?.summary ?? ""}`).join("\n");
  try {
    await brain().stream({ task: "brief", system: BRIEF_SYSTEM, context, prompt: `<past_sessions>\n${past || "none"}\n</past_sessions>\n<open_promises>\n${promises.map((p) => `- To ${p.person.name}: ${p.fact.text}`).join("\n") || "none"}\n</open_promises>`, maxTokens: 2000 }, (t) => {
      card.body += t;
      send("live:delta", { id: card.id, text: t });
    });
  } catch (e) {
    card.body ||= `Brief failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  card.done = true;
  send("live:done", { ...card });
}

async function stopSession(debrief = true) {
  stopCapture();
  setTimeout(refreshTray, 0);
  const meta = liveMeta;
  liveMeta = null;
  if (practice) {
    const p = practice;
    practice = null;
    p.dispose();
    if (p.utterances.length > 1 && meta) {
      store.saveSession({ id: p.id, title: `Practice: ${meta.title}`, playbookId: meta.playbookId, startedAt: p.startedAt, endedAt: Date.now(), utterances: p.utterances, cards: p.cards, stats: null, people: [] });
      store.applyDebrief(p.id, {
        title: `Practice: ${store.playbook(meta.playbookId)?.name ?? "session"} (avg ${p.average().toFixed(1)}/5)`,
        summary: `${p.grades.length} answers graded, average ${p.average().toFixed(1)}/5.`,
        decisions: [],
        actionItems: [],
        followUp: { to: "", subject: "", body: "" },
        coaching: { strengths: p.grades.flatMap((g) => g.worked).slice(0, 5), improve: p.grades.flatMap((g) => g.improve).slice(0, 5), moments: p.grades.map((g, i) => ({ quote: `Answer ${i + 1}`, note: g.stronger })) },
        people: [],
      });
      send("sessions:changed");
    }
    send("live:stopped", { id: p.id });
    return;
  }
  if (!live || !meta) return;
  const l = live;
  live = null;
  const stats = l.stats();
  const people = meta.attendees.map((a) => (a.id.startsWith("new:") ? store.upsertPerson({ name: a.name, lastSeen: Date.now() }) : a));
  send("live:stopped", { id: l.id, debriefing: debrief && l.utterances.length >= 2 });
  if (!debrief || l.utterances.length < 2) {
    l.dispose();
    return;
  }
  store.saveSession({ id: l.id, title: meta.title, playbookId: meta.playbookId, startedAt: l.startedAt, endedAt: Date.now(), utterances: l.utterances, cards: l.cards.filter((c) => c.done && c.body), stats, people });
  send("sessions:changed");
  try {
    const d = await l.finish();
    if (d) store.applyDebrief(l.id, d);
    send("sessions:changed");
    send("live:debriefed", { id: l.id });
    createDashboard(`#/session/${l.id}`);
  } catch (e) {
    send("live:error", `Debrief failed: ${e instanceof Error ? e.message : String(e)}. The transcript is saved.`);
  }
}

async function assist(mode: "answer" | "suggest", question?: string, withScreen?: boolean) {
  if (!overlay) createOverlay();
  if (!overlay!.isVisible() && !process.env.CUE_SNAPSHOT_DIR) overlay!.showInactive();
  if (!live && !practice) {
    live = new LiveSession({ brain: brain(), memory: store, playbook: store.playbook("meeting"), attendees: [], insights: false, coach: false, autoSuggest: false });
    liveMeta = { playbookId: "meeting", attendees: [], mode: "adhoc", title: "Quick ask" };
    wire(live);
    send("live:started", { mode: "adhoc", title: "Quick ask", playbook: store.playbook("meeting"), attendees: [], brain: brain().name, stealth: settings().stealth });
  }
  if (!live) return;
  let image: string | undefined;
  if (withScreen ?? (mode === "answer" && settings().screenshotOnAsk)) {
    try {
      image = await captureScreen();
    } catch (e) {
      send("live:error", e instanceof Error ? e.message : String(e));
    }
  }
  await live.assist(mode, { question, image });
}

async function askMemory(e: IpcMainInvokeEvent, question: string) {
  const hits = store.search(question, 14);
  const people = store.people().filter((p) => new RegExp(`\\b${p.name.split(" ")[0]}\\b`, "i").test(question));
  const facts = people.flatMap((p) => store.factsFor(p.id).map((f) => `${p.name}: ${f.text}`));
  const excerpts = [...facts.map((f) => `${f} (people notes)`), ...hits.map((h) => `${h.text} [${h.source}]`)];
  let out = "";
  await brain().stream({ task: "memory", system: MEMORY_SYSTEM, context: "Answer from the user's own meeting history.", prompt: `<question>${question}</question>\n<excerpts>\n${excerpts.join("\n")}\n</excerpts>`, maxTokens: 4000 }, (t) => {
    out += t;
    e.sender.send("memory:delta", t);
  });
  return { answer: out, sources: hits };
}

function refreshTray() {
  if (!tray) return;
  const active = !!(live || practice) && liveMeta?.mode !== "adhoc";
  tray.setTitle(active ? "● Cue" : "◦ Cue");
  tray.setContextMenu(Menu.buildFromTemplate([
    active
      ? { label: `End "${liveMeta?.title ?? "call"}"`, click: () => void stopSession() }
      : { label: "Start a call…", accelerator: "CommandOrControl+Shift+L", click: () => { if (!overlay) createOverlay(); overlay?.showInactive(); send("ui:start"); } },
    { label: "Rehearse demo call", enabled: !active, click: () => void startSession({ mode: "rehearsal", playbookId: "interview", attendees: [] }) },
    { type: "separator" },
    { label: "Show / hide overlay", accelerator: "CommandOrControl+\\", click: toggleOverlay },
    { label: "Open dashboard", accelerator: "CommandOrControl+Shift+D", click: () => createDashboard() },
    { type: "separator" },
    { label: "Quit Cue", role: "quit" },
  ]));
}

function registerShortcuts() {
  const map: Record<string, () => void> = {
    "CommandOrControl+Enter": () => void assist("answer"),
    "CommandOrControl+Shift+Enter": () => void assist("suggest", undefined, false),
    "CommandOrControl+\\": toggleOverlay,
    "CommandOrControl+Shift+L": () => (live && liveMeta?.mode !== "adhoc") || practice ? void stopSession() : send("ui:start"),
    "CommandOrControl+Shift+M": () => {
      clickThrough = !clickThrough;
      overlay?.setIgnoreMouseEvents(clickThrough, { forward: true });
      send("ui:clickthrough", clickThrough);
    },
    "CommandOrControl+Shift+K": () => send("ui:clear"),
    "CommandOrControl+Shift+D": () => createDashboard(),
    "Alt+CommandOrControl+Up": () => nudgeOverlay(0, -60),
    "Alt+CommandOrControl+Down": () => nudgeOverlay(0, 60),
    "Alt+CommandOrControl+Left": () => nudgeOverlay(-60, 0),
    "Alt+CommandOrControl+Right": () => nudgeOverlay(60, 0),
  };
  for (const [acc, fn] of Object.entries(map)) {
    if (!globalShortcut.register(acc, fn)) console.warn(`shortcut taken: ${acc}`);
  }
}

function nudgeOverlay(dx: number, dy: number) {
  if (!overlay) return;
  const [x, y] = overlay.getPosition();
  overlay.setPosition(x + dx, y + dy);
}

let calCache: { url: string; at: number; text: string } | null = null;

async function upcoming(): Promise<(CalEvent & { people: string[]; playbookId: string })[]> {
  const s = settings();
  if (!s.calendarUrl) return [];
  if (!calCache || calCache.url !== s.calendarUrl || Date.now() - calCache.at > 5 * 60000) {
    const res = await fetch(s.calendarUrl.replace(/^webcal:/, "https:"));
    if (!res.ok) throw new Error(`Calendar fetch failed (${res.status})`);
    calCache = { url: s.calendarUrl, at: Date.now(), text: await res.text() };
  }
  const mine = s.myEmails.toLowerCase().split(/[,\s]+/).filter(Boolean);
  const now = Date.now();
  return parseIcs(calCache.text, now - 15 * 60000, now + 36 * 3600000)
    .filter((e) => e.end - e.start < 12 * 3600000)
    .slice(0, 12)
    .map((e) => ({ ...e, people: e.attendees.filter((a) => !mine.includes(a.email.toLowerCase())).map(displayName).filter(Boolean).slice(0, 8), playbookId: guessPlaybook(e.title) }));
}

function registerIpc() {
  const h = (ch: string, fn: (e: IpcMainInvokeEvent, ...a: never[]) => unknown) => ipcMain.handle(ch, fn as never);
  h("session:start", (_e, opts: StartOpts) => startSession(opts));
  h("session:stop", (_e, debrief: boolean) => stopSession(debrief ?? true));
  h("session:state", () => ({ active: !!(live || practice) && liveMeta?.mode !== "adhoc", meta: liveMeta, utterances: live?.utterances ?? practice?.utterances ?? [], cards: live?.cards ?? practice?.cards ?? [] }));
  h("assist", (_e, mode: "answer" | "suggest", question?: string, withScreen?: boolean) => assist(mode, question, withScreen));
  h("practice:submit", () => practice?.submit());
  h("practice:answer", (_e, text: string) => practice?.answerText(text));
  h("insights:now", () => live?.runInsights(true));
  ipcMain.on("mic:pcm", (_e, buf: ArrayBuffer) => streams.me?.write(Buffer.from(buf)));
  h("overlay:resize", (_e, height: number) => {
    if (!overlay) return;
    const [w] = overlay.getSize();
    overlay.setSize(w, Math.max(160, Math.min(900, Math.round(height))));
  });
  h("overlay:hide", () => overlay?.hide());
  h("dashboard:open", (_e, route?: string) => createDashboard(route));
  h("settings:get", () => publicSettings(store));
  h("settings:set", (_e, patch: Partial<Settings>) => {
    writeSettings(store, patch);
    if (patch.stealth !== undefined) overlay?.setContentProtection(patch.stealth);
    send("settings:changed", publicSettings(store));
    return publicSettings(store);
  });
  h("calendar:upcoming", () => upcoming().catch((e) => ({ error: e instanceof Error ? e.message : String(e) })));
  h("playbooks:list", () => store.playbooks());
  h("playbooks:save", (_e, p) => store.savePlaybook(p));
  h("playbooks:delete", (_e, id: string) => store.deletePlaybook(id));
  h("people:list", () => store.people().map((p) => ({ ...p, factCount: store.factsFor(p.id).length, sessionCount: store.sessionsWith(p.id).length })));
  h("people:get", (_e, id: string) => {
    const p = store.person(id);
    return p ? { ...p, facts: store.factsFor(id), sessions: store.sessionsWith(id) } : null;
  });
  h("people:save", (_e, p: Person) => (p.id ? store.updatePerson(p) : store.upsertPerson(p)));
  h("people:delete", (_e, id: string) => store.deletePerson(id));
  h("facts:add", (_e, personId: string, text: string) => store.addFact(personId, text, null));
  h("facts:delete", (_e, id: string) => store.deleteFact(id));
  h("sessions:list", () => store.sessions());
  h("sessions:get", (_e, id: string) => store.session(id));
  h("sessions:delete", (_e, id: string) => {
    store.deleteSession(id);
    send("sessions:changed");
  });
  h("promises:list", () => store.openPromises());
  h("search", (_e, q: string) => store.search(q, 30));
  h("memory:ask", askMemory);
  h("clipboard:write", (_e, text: string) => clipboard.writeText(text));
  h("mail:open", (_e, to: string, subject: string, body: string) => shell.openExternal(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`));
  h("data:wipe", () => {
    for (const t of ["sessions", "utterances", "cards", "session_people", "facts", "people", "search_fts"]) store.db.exec(`DELETE FROM ${t}`);
    send("sessions:changed");
  });
}

app.whenReady().then(() => {
  store = new Store(join(app.getPath("userData"), "cue.db"));
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));
  electronSession.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  registerIpc();
  registerShortcuts();
  tray = new Tray(nativeImage.createEmpty());
  refreshTray();
  createOverlay();
  if (process.env.CUE_AUTOSTART) setTimeout(() => void startSession({ mode: "rehearsal", playbookId: process.env.CUE_AUTOSTART!, attendees: (process.env.CUE_ATTENDEES ?? "").split(",") }), 1500);
  else if (process.env.CUE_REHEARSAL === "1") setTimeout(() => send("ui:start", { rehearse: true }), 800);
  if (process.env.CUE_SNAPSHOT_DIR) startSnapshots(process.env.CUE_SNAPSHOT_DIR);
  if (process.env.CUE_AUTOSTOP_MS) setTimeout(() => void stopSession(true), 1500 + Number(process.env.CUE_AUTOSTOP_MS));
  if (!process.env.CUE_NO_DASHBOARD) createDashboard();
});

function startSnapshots(dir: string) {
  let n = 0;
  const routes = (process.env.CUE_SNAPSHOT_ROUTES ?? "").split(",").filter(Boolean);
  setInterval(async () => {
    n++;
    if (routes.length && dashboard) {
      dashboard.webContents.send("nav", routes[n % routes.length]);
      await new Promise((r) => setTimeout(r, 700));
    }
    for (const [name, w] of [["overlay", overlay], ["dashboard", dashboard]] as const) {
      if (!w || w.isDestroyed()) continue;
      const img = await w.webContents.capturePage();
      writeFileSync(join(dir, `${name}-${String(n).padStart(3, "0")}.png`), img.toPNG());
    }
  }, Number(process.env.CUE_SNAPSHOT_MS ?? 4000));
}

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopCapture();
  store?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => createDashboard());
