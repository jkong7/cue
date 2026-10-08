export interface CalEvent {
  uid: string;
  title: string;
  start: number;
  end: number;
  attendees: { name: string; email: string }[];
  location: string;
  link: string;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): Prop | null {
  const i = line.indexOf(":");
  if (i < 0) return null;
  const [name, ...rawParams] = line.slice(0, i).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const [k, v] = p.split("=");
    if (k) params[k.toUpperCase()] = (v ?? "").replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

function tzOffset(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

export function parseIcsDate(value: string, tz?: string): number {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return NaN;
  const [, y, mo, d, h = "0", mi = "0", s = "0", z] = m;
  const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (z) return naive;
  if (!m[4]) return new Date(+y, +mo - 1, +d).getTime();
  if (tz) {
    try {
      const guess = naive - tzOffset(naive, tz);
      return naive - tzOffset(guess, tz);
    } catch {
      return new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
    }
  }
  return new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
}

const unescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function occurrences(start: number, end: number, rrule: string, from: number, to: number, exdates: Set<number>): [number, number][] {
  const rule = Object.fromEntries(rrule.split(";").map((p) => p.split("=")));
  const dur = end - start;
  const freq = rule.FREQ;
  const interval = Number(rule.INTERVAL ?? 1);
  const until = rule.UNTIL ? parseIcsDate(rule.UNTIL) : Infinity;
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const byday: string[] = rule.BYDAY ? rule.BYDAY.split(",").map((d: string) => d.slice(-2)) : [];
  const out: [number, number][] = [];
  if (freq !== "DAILY" && freq !== "WEEKLY") return out;
  const day = 86400000;
  let n = 0;
  const base = new Date(start);
  const weekStart = new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay()).getTime();
  for (let i = 0; i < 3700; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, base.getHours(), base.getMinutes(), base.getSeconds());
    const t = d.getTime();
    if (t > until || t > to || n >= count) break;
    let ok: boolean;
    if (freq === "DAILY") ok = i % interval === 0;
    else {
      const weeks = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - weekStart) / (7 * day));
      ok = weeks % interval === 0 && (byday.length ? byday.includes(DAYS[d.getDay()]) : d.getDay() === base.getDay());
    }
    if (!ok) continue;
    n++;
    if (t + dur >= from && !exdates.has(t)) out.push([t, t + dur]);
  }
  return out;
}

export function parseIcs(text: string, from: number, to: number): CalEvent[] {
  const events: CalEvent[] = [];
  const overrides = new Map<string, Set<number>>();
  let cur: Prop[] | null = null;
  const raw: Prop[][] = [];
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") cur = [];
    else if (line === "END:VEVENT") {
      if (cur) raw.push(cur);
      cur = null;
    } else if (cur) {
      const p = parseLine(line);
      if (p) cur.push(p);
    }
  }
  for (const props of raw) {
    const get = (n: string) => props.find((p) => p.name === n);
    const uid = get("UID")?.value ?? "";
    const rid = get("RECURRENCE-ID");
    if (rid) {
      const set = overrides.get(uid) ?? new Set<number>();
      set.add(parseIcsDate(rid.value, rid.params.TZID));
      overrides.set(uid, set);
    }
  }
  for (const props of raw) {
    const get = (n: string) => props.find((p) => p.name === n);
    if (get("STATUS")?.value === "CANCELLED") continue;
    const ds = get("DTSTART");
    if (!ds) continue;
    const start = parseIcsDate(ds.value, ds.params.TZID);
    const de = get("DTEND");
    const end = de ? parseIcsDate(de.value, de.params.TZID) : start + 3600000;
    if (Number.isNaN(start)) continue;
    const uid = get("UID")?.value ?? `${start}`;
    const desc = unescape(get("DESCRIPTION")?.value ?? "");
    const location = unescape(get("LOCATION")?.value ?? "");
    const link = (`${location} ${desc}`.match(/https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com)\/[^\s"<>]+/) ?? [""])[0];
    const attendees = props.filter((p) => p.name === "ATTENDEE").map((p) => ({ email: p.value.replace(/^mailto:/i, ""), name: p.params.CN && !p.params.CN.includes("@") ? p.params.CN : "" })).filter((a) => !/resource\.calendar\.google\.com/.test(a.email));
    const base = { uid, title: unescape(get("SUMMARY")?.value ?? "(no title)"), attendees, location, link };
    const rrule = get("RRULE")?.value;
    if (rrule && !get("RECURRENCE-ID")) {
      const ex = new Set<number>(props.filter((p) => p.name === "EXDATE").flatMap((p) => p.value.split(",").map((v) => parseIcsDate(v, p.params.TZID))));
      for (const t of overrides.get(uid) ?? []) ex.add(t);
      for (const [s, e] of occurrences(start, end, rrule, from, to, ex)) events.push({ ...base, start: s, end: e });
    } else if (end >= from && start <= to) events.push({ ...base, start, end });
  }
  return events.sort((a, b) => a.start - b.start);
}

export function displayName(a: { name: string; email: string }): string {
  if (a.name) return a.name;
  const local = a.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\d+/g, "").trim();
  return local.split(" ").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function guessPlaybook(title: string): string {
  const t = title.toLowerCase();
  if (/interview|recruit|screen|onsite|hiring/.test(t)) return "interview";
  if (/demo|discovery|sales|pilot|prospect|intro call/.test(t)) return "sales";
  if (/coffee|chat|catch up|networking|1:1 with/.test(t)) return "networking";
  if (/lecture|class|seminar|office hours|cs \d|comp_sci/.test(t)) return "lecture";
  if (/negotiat|offer|contract/.test(t)) return "negotiation";
  return "meeting";
}
