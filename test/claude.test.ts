import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ClaudeBrain, RefusalError } from "../src/engine/claude.ts";

function sse(text: string, stopReason = "end_turn") {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return [
    ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }),
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    ...text.match(/.{1,6}/gs)!.map((t) => ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } })),
    ev("content_block_stop", { index: 0 }),
    ev("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }),
    ev("message_stop", {}),
  ].join("");
}

async function fakeApi(reply: (body: Record<string, unknown>) => { text: string; stop?: string }) {
  const seen: { headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      seen.push({ headers: req.headers, body });
      const r = reply(body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse(r.text, r.stop));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  return { seen, close: () => server.close() };
}

test("claude brain sends a well-formed streaming request and returns text", async () => {
  const api = await fakeApi(() => ({ text: "**Say this:** hello there" }));
  try {
    const brain = new ClaudeBrain({ apiKey: "test-key", liveEffort: "low" });
    let streamed = "";
    const out = await brain.stream({ task: "assist", system: "SYS", context: "CTX sk-ant-api03-abcdefghijklmnop", prompt: "card 4242 4242 4242 4242", image: "aGVsbG8=" }, (t) => (streamed += t));
    assert.equal(out, "**Say this:** hello there");
    assert.equal(streamed, out);
    const { headers, body } = api.seen[0];
    assert.equal(headers["x-api-key"], "test-key");
    assert.match(String(headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
    assert.equal(body.model, "claude-opus-5-5");
    assert.equal(body.stream, true);
    assert.equal(body.fallbacks, "default");
    assert.deepEqual(body.thinking, { type: "adaptive" });
    assert.deepEqual(body.output_config, { effort: "low" });
    const system = body.system as { text: string; cache_control?: object }[];
    assert.equal(system[0].text, "SYS");
    assert.ok(system[1].cache_control);
    assert.doesNotMatch(system[1].text, /sk-ant/);
    const content = (body.messages as { content: { type: string; text?: string }[] }[])[0].content;
    assert.equal(content[0].type, "image");
    assert.equal(content[1].text, "card [card number]");
  } finally {
    api.close();
  }
});

test("claude brain json uses structured output and parses it", async () => {
  const api = await fakeApi(() => ({ text: JSON.stringify({ cards: [{ kind: "define", title: "p99", body: "slowest 1%" }] }) }));
  try {
    const brain = new ClaudeBrain({ apiKey: "k" });
    const out = await brain.json<{ cards: { title: string }[] }>({ task: "debrief", system: "s", context: "c", prompt: "p" }, { type: "object" });
    assert.equal(out.cards[0].title, "p99");
    const body = api.seen[0].body;
    assert.deepEqual(body.output_config, { effort: "high", format: { type: "json_schema", schema: { type: "object" } } });
  } finally {
    api.close();
  }
});

test("claude brain surfaces refusals", async () => {
  const api = await fakeApi(() => ({ text: "no", stop: "refusal" }));
  try {
    const brain = new ClaudeBrain({ apiKey: "k" });
    await assert.rejects(brain.stream({ task: "assist", system: "s", context: "c", prompt: "p" }, () => {}), RefusalError);
  } finally {
    api.close();
  }
});
