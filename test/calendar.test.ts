import { test } from "node:test";
import assert from "node:assert/strict";
import { displayName, guessPlaybook, parseIcs, parseIcsDate } from "../src/engine/calendar.ts";

const ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:one
DTSTART:20261008T200000Z
DTEND:20261008T203000Z
SUMMARY:Lumen interview with Priya
ATTENDEE;CN=Priya Raman;ROLE=REQ-PARTICIPANT:mailto:priya@lumen.dev
ATTENDEE;CN=jonny@example.com:mailto:jonny@example.com
ATTENDEE:mailto:room-1@resource.calendar.google.com
DESCRIPTION:Join: https://meet.google.com/abc-defg-hij\\nThanks
END:VEVENT
BEGIN:VEVENT
UID:weekly
DTSTART;TZID=America/Chicago:20260901T150000
DTEND;TZID=America/Chicago:20260901T160000
RRULE:FREQ=WEEKLY;BYDAY=TU,TH
SUMMARY:CS 396 lecture
EXDATE;TZID=America/Chicago:20261008T150000
END:VEVENT
BEGIN:VEVENT
UID:gone
DTSTART:20261008T180000Z
DTEND:20261008T190000Z
STATUS:CANCELLED
SUMMARY:Cancelled
END:VEVENT
END:VCALENDAR`;

test("ics dates", () => {
  assert.equal(parseIcsDate("20261008T200000Z"), Date.UTC(2026, 9, 8, 20));
  assert.equal(parseIcsDate("20261008T150000", "America/Chicago"), Date.UTC(2026, 9, 8, 20));
  assert.equal(parseIcsDate("20260115T090000", "America/Chicago"), Date.UTC(2026, 0, 15, 15));
});

test("ics events, recurrence, exdate, cancelled", () => {
  const from = Date.UTC(2026, 9, 6);
  const to = Date.UTC(2026, 9, 10);
  const ev = parseIcs(ICS, from, to);
  const titles = ev.map((e) => e.title);
  assert.ok(titles.includes("Lumen interview with Priya"));
  assert.ok(!titles.includes("Cancelled"));
  const lectures = ev.filter((e) => e.title === "CS 396 lecture");
  assert.equal(lectures.length, 1);
  const one = ev.find((e) => e.uid === "one")!;
  assert.equal(one.link, "https://meet.google.com/abc-defg-hij");
  assert.equal(one.attendees.length, 2);
  assert.equal(displayName(one.attendees[0]), "Priya Raman");
  assert.equal(displayName({ name: "", email: "marcus.webb@northline.com" }), "Marcus Webb");
  assert.equal(guessPlaybook(one.title), "interview");
  assert.equal(guessPlaybook("CS 396 lecture"), "lecture");
});
