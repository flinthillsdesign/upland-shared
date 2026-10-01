import { test } from "node:test";
import assert from "node:assert";
import { fromHeader, sendMail, mailConfigured } from "../src/mail";

const mail = { to: "client@example.org", subject: "Hello", html: "<p>Hi</p>", text: "Hi" };
const noWait = async () => {};
function fakeFetch(replies: Array<{ status: number; body?: any } | Error>) {
  const calls: any[] = [];
  const fn: any = async (url: string, init: any) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {} };
  };
  return { fn, calls };
}

test("From reads the same whichever way the setting is written", () => {
  assert.equal(fromHeader(undefined), "Upland Exhibits <info@uplandexhibits.com>");
  assert.equal(fromHeader("info@uplandexhibits.com"), "Upland Exhibits <info@uplandexhibits.com>");
  assert.equal(fromHeader("Upland Exhibits <info@uplandexhibits.com>"), "Upland Exhibits <info@uplandexhibits.com>");
  assert.equal(fromHeader("info@uplandexhibits.com", "ODIN"), "ODIN <info@uplandexhibits.com>");
  // The bug this replaces: `ODIN <${"Name <addr>"}>` nested the brackets.
  assert.equal(fromHeader("Upland Exhibits <info@uplandexhibits.com>", "ODIN"), "ODIN <info@uplandexhibits.com>");
  assert.equal(fromHeader('"Upland" <a@b.co>'), "Upland <a@b.co>");
});

test("no token: nothing is sent and the result says so", async () => {
  const f = fakeFetch([{ status: 200 }]);
  const r = await sendMail(mail, { token: "", fetch: f.fn });
  assert.deepEqual(r, { sent: false, reason: "not_configured", error: "POSTMARK_API_TOKEN is not set" });
  assert.equal(f.calls.length, 0);
  assert.equal(mailConfigured(""), false);
  assert.equal(mailConfigured("abc"), true);
});

test("links are never rewritten and opens never tracked", async () => {
  const f = fakeFetch([{ status: 200, body: { MessageID: "m-1" } }]);
  const r = await sendMail({ ...mail, fromName: "ODIN", replyTo: "in@example.org" }, { token: "t", from: "info@uplandexhibits.com", fetch: f.fn });
  assert.deepEqual(r, { sent: true, id: "m-1" });
  const b = f.calls[0].body;
  assert.equal(f.calls[0].url, "https://api.postmarkapp.com/email");
  assert.equal(f.calls[0].headers["X-Postmark-Server-Token"], "t");
  assert.equal(b.TrackLinks, "None");
  assert.equal(b.TrackOpens, false);
  assert.equal(b.MessageStream, "outbound");
  assert.equal(b.From, "ODIN <info@uplandexhibits.com>");
  assert.equal(b.ReplyTo, "in@example.org");
  assert.equal(b.To, "client@example.org");
  assert.equal("Attachments" in b, false);
});

test("attachments ride along", async () => {
  const f = fakeFetch([{ status: 200, body: { MessageID: "m-2" } }]);
  const att = [{ Name: "a.pdf", Content: "QUJD", ContentType: "application/pdf" }];
  await sendMail({ ...mail, attachments: att }, { token: "t", fetch: f.fn });
  assert.deepEqual(f.calls[0].body.Attachments, att);
});

test("Postmark saying no is not retried", async () => {
  const f = fakeFetch([{ status: 422, body: { Message: "Inactive recipient" } }]);
  const r = await sendMail(mail, { token: "t", fetch: f.fn, wait: noWait });
  assert.deepEqual(r, { sent: false, reason: "refused", error: "Postmark 422: Inactive recipient" });
  assert.equal(f.calls.length, 1);
});

test("a dropped connection or a 5xx is tried again, then passes", async () => {
  const f = fakeFetch([new Error("fetch failed"), { status: 503 }, { status: 200, body: { MessageID: "m-3" } }]);
  const r = await sendMail(mail, { token: "t", fetch: f.fn, wait: noWait });
  assert.deepEqual(r, { sent: true, id: "m-3" });
  assert.equal(f.calls.length, 3);
});

test("it gives up after the tries allowed, and never throws", async () => {
  const f = fakeFetch([new Error("socket hang up")]);
  const r = await sendMail(mail, { token: "t", fetch: f.fn, wait: noWait, attempts: 2 });
  assert.equal(r.sent, false);
  assert.equal(!r.sent && r.reason, "failed");
  assert.equal(f.calls.length, 2);
});
