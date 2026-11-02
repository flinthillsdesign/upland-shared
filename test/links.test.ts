import { test } from "node:test";
import assert from "node:assert";
import { CLIENT_LINK, PROJECT_LINK, PRINTER_LINK, SESSION_DAYS, normalizeEmail, maskEmail, safePath, linkUrl, newToken, linkStore, ensureLinkSchema, signInMail, linkFoot } from "../src/links";

test("the terms are the ones Joel set", () => {
  assert.deepEqual(CLIENT_LINK, { days: 10, reuse: true });
  assert.deepEqual(PROJECT_LINK, { days: 30, reuse: true });
  assert.deepEqual(PRINTER_LINK, { days: 90, reuse: true });
  assert.equal(SESSION_DAYS, 90);
});

test("addresses, masks, paths, urls", () => {
  assert.equal(normalizeEmail("  Sarah@Example.ORG "), "sarah@example.org");
  assert.equal(maskEmail("sarah@example.org"), "s•••@example.org");
  assert.equal(maskEmail("nonsense"), "•••");
  assert.equal(safePath("/object.html?id=1"), "/object.html?id=1");
  assert.equal(safePath("//evil.example"), undefined);
  assert.equal(safePath("https://evil.example"), undefined);
  assert.equal(safePath("/\\evil"), undefined);
  assert.equal(linkUrl("https://objects.uplandexhibits.com/", "abc", "/x?y=1"), "https://objects.uplandexhibits.com/?t=abc&next=%2Fx%3Fy%3D1");
  assert.equal(linkUrl("https://objects.uplandexhibits.com", "abc", "https://evil.example"), "https://objects.uplandexhibits.com/?t=abc");
  const t = newToken();
  assert.ok(/^[A-Za-z0-9_-]{32}$/.test(t) && t !== newToken());
});

// A scripted database: each execute pops the next reply. Enough to check
// the store asks the right questions and reads the answers right.
function fakeDb(replies: Array<{ rows?: unknown[]; rowsAffected?: number }>) {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    async execute(stmt: string | { sql: string; args: unknown[] }) {
      calls.push(typeof stmt === "string" ? { sql: stmt, args: [] } : stmt);
      const r = replies.shift() || {};
      return { rows: r.rows || [], rowsAffected: r.rowsAffected ?? 0 };
    },
  };
}

test("schema makes both tables and tolerates existing columns", async () => {
  const db = fakeDb([{}, {}, {}, {}]);
  db.execute = (async (s: any) => { const sql = typeof s === "string" ? s : s.sql; db.calls.push({ sql, args: [] }); if (sql.startsWith("ALTER")) throw new Error("duplicate column"); return { rows: [], rowsAffected: 0 }; }) as any;
  await ensureLinkSchema(db);
  assert.ok(db.calls.some((c) => c.sql.includes("member_links")) && db.calls.some((c) => c.sql.includes("member_sessions")));
});

test("a live link signs in its address; a dead one does not", async () => {
  const live = fakeDb([{ rows: [{ email: "sarah@example.org" }] }, { rowsAffected: 1 }]);
  assert.equal(await linkStore(live).useLink("tok"), "sarah@example.org");
  assert.match(live.calls[0].sql, /expires_at > datetime\('now'\)/);
  assert.match(live.calls[0].sql, /used_at IS NULL OR reuse = 1/);
  const dead = fakeDb([{ rows: [] }]);
  assert.equal(await linkStore(dead).useLink("tok"), null);
});

test("createLink stores the normalised address with the terms' days", async () => {
  const db = fakeDb([{ rowsAffected: 1 }]);
  await linkStore(db).createLink(" Sarah@Example.org ", PROJECT_LINK);
  assert.deepEqual(db.calls[0].args.slice(1), ["sarah@example.org", "+30 days", 1]);
});

test("relink is allowed once per window", async () => {
  const db = fakeDb([{ rowsAffected: 1 }, { rowsAffected: 0 }]);
  const s = linkStore(db);
  assert.equal(await s.relinkAllowed("tok"), true);
  assert.equal(await s.relinkAllowed("tok"), false);
  assert.match(db.calls[0].sql, /-10 minutes/);
});

test("the mail says who, what, how long", () => {
  const m = signInMail({ app: "Objects", url: "https://o.example/?t=x", what: "the ECHS Volga German gallery object list", invitedBy: "Joel", terms: PROJECT_LINK });
  assert.equal(m.subject, "Sign in to Objects: the ECHS Volga German gallery object list");
  assert.match(m.text, /^Joel added you to the ECHS Volga German gallery object list\./);
  assert.match(m.text, /thirty days/);
  assert.ok(m.html.includes('href="https://o.example/?t=x"'));
  assert.match(linkFoot(PRINTER_LINK), /forward it to a colleague/);
  assert.match(linkFoot(CLIENT_LINK), /ten days/);
  assert.match(signInMail({ app: "Graphics", url: "https://x/?t=a", what: "Upland's print files for Prairie Print Co." }).text, /Prairie Print Co\.\n/);
  assert.match(signInMail({ app: "Graphics", url: "https://x/?t=a", what: "Ireland", invitedBy: "Joel" }).text, /^Joel added you to Ireland\.\n/);
  assert.equal(linkFoot(PRINTER_LINK, "these batches"), "The link signs you in and is yours to keep: it works as often as you like for 90 days, and you can forward it to a colleague who should see these batches. After that, ask for a new one on the sign-in page.");
  const plain = signInMail({ app: "Graphics", url: "u", what: "Volga" });
  assert.match(plain.text, /^Here is your sign-in link for Volga\./);
});
