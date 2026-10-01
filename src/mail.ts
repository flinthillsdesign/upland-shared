// ── One way to send mail ─────────────────────────────────────────────────
// Every app sends through Postmark, and each had its own sender. They had
// drifted: link tracking was off in one app only (so signing, sign-in and
// proposal links were rewritten through a tracking host everywhere else),
// POSTMARK_FROM_EMAIL meant "Name <address>" in some apps and a bare address
// in others, and two apps reported "sent" when no mail was configured.
//
// sendMail is the one sender:
//   - links are never rewritten and opens are never tracked;
//   - From is "<name> <address>" whichever way the env var is written;
//   - it never throws — the result says whether mail went, and if not, why;
//   - "not configured" is NOT sent: a caller that tells a person "we emailed
//     you" must check `sent`.
//
// It talks to Postmark's HTTP API with fetch, so this package needs no
// dependency. Words, layout and who gets mail stay in each app.

export interface MailAttachment {
  Name: string;
  Content: string; // base64
  ContentType: string;
}

export interface Mail {
  to: string; // one address, or several separated by commas (one message)
  subject: string;
  html: string;
  text: string;
  fromName?: string; // "ODIN" → "ODIN <info@uplandexhibits.com>"
  replyTo?: string;
  attachments?: MailAttachment[];
}

export type MailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not_configured" | "refused" | "failed"; error: string };

export interface MailOptions {
  token?: string; // default: process.env.POSTMARK_API_TOKEN
  from?: string; // default: process.env.POSTMARK_FROM_EMAIL
  attempts?: number; // tries in all for a network error, 429 or 5xx (default 3)
  fetch?: typeof fetch; // for tests
  wait?: (ms: number) => Promise<void>; // for tests
}

const DEFAULT_ADDRESS = "info@uplandexhibits.com";
const DEFAULT_NAME = "Upland Exhibits";
const ENDPOINT = "https://api.postmarkapp.com/email";

// The From header. `raw` is POSTMARK_FROM_EMAIL as each app happens to have
// it: "Name <address>", a bare address, or unset. `name` replaces whatever
// name the setting carries.
export function fromHeader(raw: string | undefined | null, name?: string): string {
  const value = String(raw || "").trim();
  const m = value.match(/^(.*?)<\s*([^<>\s]+)\s*>\s*$/);
  const address = m ? m[2] : value || DEFAULT_ADDRESS;
  const ownName = m ? m[1].trim().replace(/^"|"$/g, "") : "";
  const shown = (name || ownName || DEFAULT_NAME).replace(/[<>"\r\n]/g, "").trim();
  return `${shown} <${address}>`;
}

// Is a mail token set? For the rare caller that must know before it acts
// (a sign-in link that may be handed back on a local machine instead).
export function mailConfigured(token: string | undefined = process.env.POSTMARK_API_TOKEN): boolean {
  return !!token;
}

export async function sendMail(mail: Mail, opts: MailOptions = {}): Promise<MailResult> {
  const token = opts.token ?? process.env.POSTMARK_API_TOKEN;
  if (!token) {
    console.warn(`[mail] POSTMARK_API_TOKEN is not set; nothing sent: ${mail.subject}`);
    return { sent: false, reason: "not_configured", error: "POSTMARK_API_TOKEN is not set" };
  }
  const body: Record<string, unknown> = {
    From: fromHeader(opts.from ?? process.env.POSTMARK_FROM_EMAIL, mail.fromName),
    To: mail.to,
    Subject: mail.subject,
    HtmlBody: mail.html,
    TextBody: mail.text,
    MessageStream: "outbound",
    // The links people click are the links we wrote.
    TrackLinks: "None",
    TrackOpens: false,
  };
  if (mail.replyTo) body.ReplyTo = mail.replyTo;
  if (mail.attachments?.length) body.Attachments = mail.attachments;

  const doFetch = opts.fetch ?? fetch;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = Math.max(1, opts.attempts ?? 3);
  let last = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await doFetch(ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": token,
        },
        body: JSON.stringify(body),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) return { sent: true, id: data?.MessageID ?? null };
      last = `Postmark ${res.status}: ${data?.Message || "no message"}`;
      // A 4xx is Postmark saying no (bad address, inactive recipient, bad
      // token): trying again changes nothing. 429 and 5xx may pass.
      if (res.status < 500 && res.status !== 429) {
        console.error(`[mail] refused, to ${mail.to}: ${last}`);
        return { sent: false, reason: "refused", error: last };
      }
    } catch (err: any) {
      last = String(err?.message || err);
    }
    if (attempt < attempts) await wait(1000 * attempt);
  }
  console.error(`[mail] failed after ${attempts} tries, to ${mail.to}: ${last}`);
  return { sent: false, reason: "failed", error: last };
}
