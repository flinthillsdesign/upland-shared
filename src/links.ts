// ── One way an outside person signs in: an emailed link ──────────────────
// Graphics worked this out with Joel (2026-10-13 → 10-30) for clients and
// printers; Objects needs the same door. The rules live here so they never
// drift again:
//
//   - A link is a random token mailed to one address. Opening it signs the
//     opener in AS THAT ADDRESS — no password, no PIN. Any number of opens
//     while it lasts (a client reads the mail on the phone, then at the
//     desk), so a forwarded link acts as the person it was mailed to; the
//     page shows who that is ("signed in as … · not you?").
//   - How long a link lasts is the only thing that differs between doors
//     (LinkTerms): proofs ten days, a project's object list thirty, a
//     printer's ninety.
//   - A used link becomes a SESSION the browser keeps (90 days, revoked on
//     sign-out). Sessions are rows too, so a person can be cut off.
//   - A dead link asks for a fresh one in one click: the old token says
//     whose it was, the new link lands where the old one was headed, the
//     page learns only a masked address — at most once every ten minutes
//     per old link (Codex, 2026-10-31), and never a word on whether an
//     address is known.
//
// What stays in the app: who may be mailed a link (its people tables), what
// a signed-in person may reach (its scope checks), the routes. This module
// gives the terms, the two tables and their queries, the tokens, the URL,
// and the mail's words. No dependency: the app passes its libsql client in.

import { randomBytes } from "node:crypto";

export const LINKS_VERSION = "1.1.1";

export interface LinkTerms {
  days: number;
  reuse: boolean;
}

// Proofs: a round is looked at and answered within days (Graphics).
export const CLIENT_LINK: LinkTerms = { days: 10, reuse: true };
// A project's own records, shaped over weeks (Objects).
export const PROJECT_LINK: LinkTerms = { days: 30, reuse: true };
// A printer's door: open and forwardable for a quarter (Graphics, Joel 2026-10-13).
export const PRINTER_LINK: LinkTerms = { days: 90, reuse: true };
export const SESSION_DAYS = 90;
export const RELINK_MINUTES = 10;

export function normalizeEmail(s: string): string {
  return String(s || "").trim().toLowerCase();
}

// What a dead-link page may show about where the fresh link went.
export function maskEmail(email: string): string {
  const [name, domain] = normalizeEmail(email).split("@");
  if (!domain) return "•••";
  return `${name.slice(0, 1)}•••@${domain}`;
}

// A path in the app a link may land on after sign-in: one of ours, never a URL.
export function safePath(next?: string | null): string | undefined {
  return next && /^\/(?![\/\\])/.test(next) ? next : undefined;
}

export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

// The link as mailed: the app's front page exchanges `t` for a session and
// goes on to `next`.
export function linkUrl(origin: string, token: string, next?: string | null): string {
  const path = safePath(next);
  return `${origin.replace(/\/$/, "")}/?t=${encodeURIComponent(token)}${path ? `&next=${encodeURIComponent(path)}` : ""}`;
}

// The slice of @libsql/client this module uses; any client with execute() fits.
export interface LinkDb {
  execute(stmt: string | { sql: string; args: unknown[] }): Promise<{ rows: unknown[]; rowsAffected: number }>;
}

// The two tables, in Graphics' shape so it can adopt this store unchanged.
export async function ensureLinkSchema(db: LinkDb): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS member_links (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    reuse INTEGER NOT NULL DEFAULT 1,
    relinked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS member_sessions (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  for (const col of ["reuse INTEGER NOT NULL DEFAULT 1", "relinked_at TEXT"]) {
    try {
      await db.execute(`ALTER TABLE member_links ADD COLUMN ${col}`);
    } catch {
      // already there
    }
  }
}

export interface LinkStore {
  createLink(email: string, terms?: LinkTerms): Promise<string>;
  // Whose a link was, expired or not (for the one-click fresh link).
  linkEmail(token: string): Promise<string | null>;
  // May this dead link ask for a fresh one now? (once per RELINK_MINUTES)
  relinkAllowed(token: string): Promise<boolean>;
  // The address a live link signs in, marking its first use; null if dead.
  useLink(token: string): Promise<string | null>;
  createSession(email: string, days?: number): Promise<string>;
  getSession(token: string): Promise<{ email: string } | null>;
  // At most one write every few minutes per session.
  touchSession(token: string): Promise<void>;
  deleteSession(token: string): Promise<void>;
  // Every session of an address: how a person is cut off.
  deleteSessionsOf(email: string): Promise<void>;
}

export function linkStore(db: LinkDb): LinkStore {
  const one = async <T>(sql: string, args: unknown[]): Promise<T | null> => ((await db.execute({ sql, args })).rows[0] as T) ?? null;
  const run = async (sql: string, args: unknown[]): Promise<number> => (await db.execute({ sql, args })).rowsAffected;
  return {
    async createLink(email, terms = CLIENT_LINK) {
      const token = newToken(24);
      await run("INSERT INTO member_links (token, email, expires_at, reuse) VALUES (?, ?, datetime('now', ?), ?)", [token, normalizeEmail(email), `+${terms.days} days`, terms.reuse ? 1 : 0]);
      return token;
    },
    async linkEmail(token) {
      const row = await one<{ email: string }>("SELECT email FROM member_links WHERE token = ?", [token]);
      return row?.email ?? null;
    },
    async relinkAllowed(token) {
      const n = await run(`UPDATE member_links SET relinked_at = datetime('now') WHERE token = ? AND (relinked_at IS NULL OR relinked_at < datetime('now', '-${RELINK_MINUTES} minutes'))`, [token]);
      return n > 0;
    },
    async useLink(token) {
      const row = await one<{ email: string }>("SELECT email FROM member_links WHERE token = ? AND (used_at IS NULL OR reuse = 1) AND expires_at > datetime('now')", [token]);
      if (!row) return null;
      await run("UPDATE member_links SET used_at = datetime('now') WHERE token = ? AND used_at IS NULL", [token]);
      return row.email;
    },
    async createSession(email, days = SESSION_DAYS) {
      const token = newToken(30);
      await run("INSERT INTO member_sessions (token, email, expires_at) VALUES (?, ?, datetime('now', ?))", [token, normalizeEmail(email), `+${days} days`]);
      return token;
    },
    getSession(token) {
      return one<{ email: string }>("SELECT email FROM member_sessions WHERE token = ? AND expires_at > datetime('now')", [token]);
    },
    async touchSession(token) {
      await run("UPDATE member_sessions SET last_used_at = datetime('now') WHERE token = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-5 minutes'))", [token]);
    },
    async deleteSession(token) {
      await run("DELETE FROM member_sessions WHERE token = ?", [token]);
    },
    async deleteSessionsOf(email) {
      await run("DELETE FROM member_sessions WHERE email = ?", [normalizeEmail(email)]);
    },
  };
}

// ── The mail ──────────────────────────────────────────────────────────────
// Fixed words (Graphics', generalised): what the link opens, who sent it,
// how long it lasts. The app supplies its name and what the link opens.

export interface SignInMailInput {
  app: string; // "Graphics", "Objects"
  url: string;
  what: string; // "the ECHS Volga German gallery object list", "Upland's print files for X-Press"
  invitedBy?: string; // a person's name: "Joel added you to …"
  terms?: LinkTerms;
  openLabel?: string; // the button: default "Open the project"
  sees?: string; // what a forwarded link shows a colleague: default "this" ("these batches")
}

export interface MailWords {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const days = (n: number) => (n === 10 ? "ten" : n === 30 ? "thirty" : n === 90 ? "90" : String(n)) + " days";

export function linkFoot(terms: LinkTerms, sees = "this"): string {
  return terms.days >= 90
    ? `The link signs you in and is yours to keep: it works as often as you like for ${days(terms.days)}, and you can forward it to a colleague who should see ${sees}. After that, ask for a new one on the sign-in page.`
    : `The link signs you in and stays good for ${days(terms.days)}. After that, one click on it asks for a fresh one.`;
}

export function signInMail(o: SignInMailInput): MailWords {
  const terms = o.terms ?? CLIENT_LINK;
  // A name that ends in its own period ("Prairie Print Co.") ends the sentence.
  const end = /[.!?]$/.test(o.what) ? "" : ".";
  const intro = o.invitedBy ? `${o.invitedBy} added you to ${o.what}${end}` : `Here is your sign-in link for ${o.what}${end}`;
  const label = o.openLabel ?? "Open the project";
  const foot = linkFoot(terms, o.sees);
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#23221f;max-width:560px">
<p style="margin:0 0 18px">${esc(intro)}</p>
<p style="margin:0 0 22px"><a href="${esc(o.url)}" style="display:inline-block;padding:11px 20px;background:#23221f;color:#fff;text-decoration:none;border-radius:4px;font-weight:600">${esc(label)}</a></p>
<p style="margin:0;color:#6c6963;font-size:13px">${esc(foot)} If you did not expect this, ignore it.</p>
</div>`;
  const text = `${intro}\n\n${label}: ${o.url}\n\n${foot} If you did not expect this, ignore it.`;
  return { subject: `Sign in to ${o.app}: ${o.what}`, html, text };
}
