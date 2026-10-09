# Cue

A real-time copilot for conversations. Cue sits in a small overlay on your Mac, hears both sides of a call, sees your screen when you ask, and helps you say the right thing. After the call it writes the debrief and follow-up email, and it remembers the people you talk to so the next conversation starts where the last one ended.

It started as a rebuild of Cluely (SF, a16z-backed, founded 2025). Cluely proved people want an assistant that already has the context of the moment, so they never write a prompt. Its product stayed thin: one-shot answers, no memory, a single mixed audio stream, and a brand built on cheating. Cue keeps the core idea and fixes those parts.

## What it does

During a call
- Separate capture for you (mic) and them (system audio), so suggestions answer the person who actually asked.
- When the other side finishes a question, a "Say this" card appears with words you can say out loud. A newer question cancels the older answer.
- `⌘↵` answers from your screen plus the conversation (coding problems, forms, docs, slides). `⌘⇧↵` answers from the conversation only.
- Live cards that stay quiet unless useful: definitions of terms that just came up, claims worth checking, openings to take. Each topic shows once.
- Recall cards: mention someone Cue has met before and it shows what you know about them.
- A brief at the start of a call with known attendees: who they are, open threads, things you promised them.
- Coaching strip: your share of the talking, pace, filler words, monologue length, with a nudge when something drifts.
- Echo suppression for when your mic picks up their voice from your speakers.

After a call
- Summary, decisions, action items with owners.
- A follow-up email draft (Copy or Open in Mail; Cue never sends anything).
- Coaching with specific moments.
- People and facts saved to memory, including what you promised.

Before a call
- Practice mode: Cue plays the interviewer or prospect, you answer out loud (or type), and every answer gets a 1-5 grade, what worked, what to fix and a tighter version in your words.
- Calendar: paste your secret iCal link and Cue shows what's next, who's attending and who it already knows. One click starts the call with the right playbook.

Anytime
- Ask your memory: "What did Priya say about their Kafka migration?" answers from your past conversations with sources.
- Playbooks for interviews, sales, meetings, lectures, coffee chats and negotiations. Paste your resume or product notes into a playbook and answers use only those facts.

## Cue vs Cluely

| | Cluely | Cue |
|---|---|---|
| Who said what | One stream, speakers often mixed up | Mic and system audio captured and transcribed separately |
| Proactive help | Retired its Live Insights in Oct 2025 | Fires only on questions aimed at you, debounced and cancellable; recall is local and free |
| Memory | None across calls | People, facts, promises, full-text search over every conversation |
| After the call | Summary and email draft | Summary, owned action items, email draft, coaching, memory updates |
| Practice | No | Graded mock interviews and sales calls |
| Grounding | Custom instructions and files | Playbooks with your background; the prompt forbids inventing experience |
| Privacy | Cloud | Local SQLite, keys in the macOS keychain, redaction of card numbers, SSNs, passwords and API keys before anything leaves the machine |
| Hidden from screen share | Default sell, $150/mo | Off by default, one toggle, documented as best effort |

## Run it

Requirements: macOS 14+, Node 22+, Xcode command line tools (for the small Swift audio helper).

```
npm install
npm run dev
```

With no keys, Cue runs in rehearsal mode: canned but realistic answers, and the "Rehearse demo" button plays a scripted interview or sales call through the real pipeline so you can see every feature work. To go live, add keys in Settings (or in `.env`, see `.env.example`):

- `ANTHROPIC_API_KEY` for answers, cards, debriefs and practice grading (Claude Opus 5.5, low effort for live work, high for debriefs).
- `DEEPGRAM_API_KEY` for live transcription (nova-3, streaming, one socket per speaker).

The first time you start a live call, macOS asks for microphone and screen and system audio recording permission for Electron (or your terminal when run from one).

## Shortcuts

| Keys | Action |
|---|---|
| `⌘↵` | Answer using screen and conversation |
| `⌘⇧↵` | What should I say (conversation only) |
| `⌘\` | Show or hide the overlay |
| `⌘⇧L` | Start or end a call |
| `⌘⇧M` | Click-through overlay |
| `⌘⇧K` | Clear cards |
| `⌘⇧D` | Dashboard |
| `⌥⌘` + arrows | Move the overlay |

## How it's built

```
native/cue-audio.swift   ScreenCaptureKit system audio -> 16 kHz PCM on stdout
src/engine/              everything testable without Electron
  session.ts             live session: merges partials, drops echo, detects questions, runs suggest/insight/recall/coach
  practice.ts            practice loop: ask, listen, grade, ask again
  claude.ts              Claude client (streaming, structured output, prompt caching, refusal fallback, redaction)
  rehearsal.ts           offline brain used when there is no key
  stt.ts                 Deepgram streaming + turn assembly, scripted call player
  store.ts               SQLite + FTS5: sessions, utterances, cards, people, facts, playbooks
  calendar.ts            iCal parsing with time zones and weekly/daily recurrence
  detect.ts coach.ts recall.ts redact.ts prompts.ts
src/main/                Electron main: overlay + dashboard windows, hotkeys, tray, screen capture, audio plumbing, IPC
src/renderer/            React overlay and dashboard, mic AudioWorklet
```

Why a native helper for system audio: Electron's built-in loopback capture is broken on current macOS unless you show the system picker every time (electron#52738), so Cue uses a small ScreenCaptureKit binary, the same approach the strongest open-source clones settled on.

## Tests

```
npm test        # 17 tests: detection, coaching, redaction, memory, calendar, live and practice sessions, Deepgram turns, Claude request shape against a fake API
npm run typecheck
```

`CUE_AUTOSTART=interview CUE_SCRIPT_SPEED=2 npm run rehearse` plays a scripted call on launch.

## Using it honestly

Cue is built to help you think and remember, not to impersonate you. The stealth toggle exists because some people want a clean screen share, but it is off by default, and in interviews or exams where assistants are not allowed, don't use it.
