import { test } from "node:test";
import assert from "node:assert";
import { createAi, firstText, wasTruncated, wasRefused, toolInput, supportsEffort, rejectsForcedTools } from "../src/ai";

// A stand-in for the Anthropic client: replies (or throws) in order.
function fake(replies: any[]) {
  const sent: any[] = [];
  const anthropic = {
    beta: {
      messages: {
        create: async (opts: any) => {
          sent.push(opts);
          const r = replies[Math.min(sent.length - 1, replies.length - 1)];
          if (r instanceof Error || r?.throw) throw r.throw || r;
          return r;
        },
      },
    },
  };
  return { anthropic, sent };
}
const text = (t: string, extra: any = {}) => ({ content: [{ type: "thinking", thinking: "…" }, { type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, ...extra });
const msg = [{ role: "user", content: "hi" }];
const noWait = async () => {};

test("reading a reply skips thinking blocks", () => {
  assert.equal(firstText(text("hello")), "hello");
  assert.equal(firstText({ content: [{ type: "thinking" }] }), "");
  assert.equal(firstText(null), "");
  assert.equal(wasTruncated(text("x", { stop_reason: "max_tokens" })), true);
  assert.equal(wasRefused(text("", { stop_reason: "refusal" })), true);
  assert.deepEqual(toolInput({ content: [{ type: "tool_use", name: "t", input: { a: 1 } }] }, "t"), { a: 1 });
  assert.equal(toolInput(text("x"), "t"), null);
});

test("which models take effort, which reject forced tools", () => {
  assert.equal(supportsEffort("claude-opus-5"), true);
  assert.equal(supportsEffort("claude-opus-5-5"), true);
  assert.equal(supportsEffort("claude-haiku-4-5-20251001"), false);
  assert.equal(rejectsForcedTools("claude-opus-5-5"), true);
  assert.equal(rejectsForcedTools("claude-opus-5"), false);
});

test("effort is added by default, the caller's own wins, null sends none", async () => {
  const f = fake([text("ok")]);
  const ai = createAi({ anthropic: f.anthropic });
  await ai.create({ model: "claude-opus-5", max_tokens: 100, messages: msg });
  assert.deepEqual(f.sent[0].output_config, { effort: "low" });
  await ai.create({ model: "claude-opus-5", max_tokens: 100, messages: msg, output_config: { effort: "high" } });
  assert.deepEqual(f.sent[1].output_config, { effort: "high" });
  await ai.create({ model: "claude-opus-5", max_tokens: 100, messages: msg, output_config: null });
  assert.equal("output_config" in f.sent[2], false);
  await ai.create({ model: "claude-haiku-4-5-20251001", max_tokens: 100, messages: msg });
  assert.equal("output_config" in f.sent[3], false);
});

test("Opus 5.5 gets fallbacks; other models don't", async () => {
  const f = fake([text("ok")]);
  const ai = createAi({ anthropic: f.anthropic });
  await ai.create({ model: "claude-opus-5-5", max_tokens: 100, messages: msg });
  assert.equal(f.sent[0].fallbacks, "default");
  assert.deepEqual(f.sent[0].betas, ["server-side-fallback-2026-07-01"]);
  await ai.create({ model: "claude-opus-5", max_tokens: 100, messages: msg });
  assert.equal("fallbacks" in f.sent[1], false);
});

test("a forced tool is relaxed on Opus 5.5 and re-asked once if not called", async () => {
  const tool = { content: [{ type: "tool_use", name: "propose", input: { n: 1 } }], stop_reason: "tool_use", usage: {} };
  const f = fake([text("I think…"), tool]);
  const ai = createAi({ anthropic: f.anthropic });
  const r = await ai.create({ model: "claude-opus-5-5", max_tokens: 100, messages: msg, tool_choice: { type: "tool", name: "propose" } });
  assert.deepEqual(f.sent[0].tool_choice, { type: "auto" });
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].messages.length, 3);
  assert.equal(f.sent[1].messages[2].content, "Call the propose tool now with your answer.");
  assert.deepEqual(toolInput(r, "propose"), { n: 1 });
});

test("a forced tool is left alone on a model that takes it", async () => {
  const f = fake([text("ok")]);
  const ai = createAi({ anthropic: f.anthropic });
  await ai.create({ model: "claude-opus-5", max_tokens: 100, messages: msg, tool_choice: { type: "tool", name: "propose" } });
  assert.deepEqual(f.sent[0].tool_choice, { type: "tool", name: "propose" });
  assert.equal(f.sent.length, 1);
});

test("a cut-off or refused reply is not re-asked for its tool", async () => {
  const f = fake([text("partial", { stop_reason: "max_tokens" })]);
  const seen: any[] = [];
  const ai = createAi({ anthropic: f.anthropic, onTruncated: (o, r) => seen.push([o.max_tokens, r.stop_reason]) });
  const r = await ai.create({ model: "claude-opus-5-5", max_tokens: 100, messages: msg, tool_choice: { type: "any" } });
  assert.equal(f.sent.length, 1);
  assert.equal(wasTruncated(r), true);
  assert.deepEqual(seen, [[100, "max_tokens"]]);
});

test("usage is reported for every request", async () => {
  const f = fake([text("ok")]);
  const seen: any[] = [];
  const ai = createAi({ anthropic: f.anthropic, onUsage: (m, u) => seen.push([m, u.output_tokens]) });
  await ai.create({ model: "claude-opus-5", max_tokens: 100, messages: msg });
  assert.deepEqual(seen, [["claude-opus-5", 5]]);
});

test("callWithRetry: a 529 is retried, a 400 is not", async () => {
  const overloaded: any = Object.assign(new Error("overloaded"), { status: 529 });
  const f = fake([overloaded, text("ok")]);
  const ai = createAi({ anthropic: f.anthropic, wait: noWait });
  assert.equal(firstText(await ai.callWithRetry({ model: "claude-opus-5", max_tokens: 100, messages: msg })), "ok");
  assert.equal(f.sent.length, 2);
  const bad: any = Object.assign(new Error("invalid request"), { status: 400 });
  const g = fake([bad]);
  await assert.rejects(() => createAi({ anthropic: g.anthropic, wait: noWait }).callWithRetry({ model: "claude-opus-5", max_tokens: 1, messages: msg }), /invalid request/);
  assert.equal(g.sent.length, 1);
});

test("callWithRetry: an effort rejection drops output_config and tries again at once", async () => {
  const rej: any = Object.assign(new Error("This model does not support the effort parameter"), { status: 400 });
  const f = fake([rej, text("ok")]);
  const ai = createAi({ anthropic: f.anthropic, wait: noWait });
  await ai.callWithRetry({ model: "claude-opus-5", max_tokens: 100, messages: msg });
  assert.deepEqual(f.sent[0].output_config, { effort: "low" });
  assert.equal("output_config" in f.sent[1], false);
});

test("callWithRetry gives up after three tries", async () => {
  const down: any = Object.assign(new Error("bad gateway"), { status: 502 });
  const f = fake([down]);
  await assert.rejects(() => createAi({ anthropic: f.anthropic, wait: noWait }).callWithRetry({ model: "claude-opus-5", max_tokens: 1, messages: msg }), /bad gateway/);
  assert.equal(f.sent.length, 3);
});
