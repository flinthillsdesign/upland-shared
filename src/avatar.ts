// ── Avatar: one face per person, everywhere ──────────────────────────────
// Every app drew its own initials disc from the person's name, each with its
// own rule for which letters and what color (ODIN and Graphics disagreed by
// 2026-10-30). This is the one rule.
//
// The photo is Basecamp's. Nobody picks a picture inside an Upland app:
// ODIN copies each person's Basecamp avatar into the shared auth DB
// (`user_avatars`, a 96px data URI, refreshed nightly and on sign-in) and
// every app reads it beside the name at login. To change the photo, change
// it in Basecamp. A person with no photo there, or no Basecamp account
// (a client's member, a printer's person), gets their initials on a color
// that is theirs alone — the same one in every app, because it hashes
// their id (or name).
//
// `avatarHtml` is the renderer. It adds its own base styles once per page
// (prepended to <head>, so an app's stylesheet still wins: Graphics keeps
// its bar's button sizing, ODIN its rounded squares). Browser or server:
// without a `document` it just returns the markup.

export const AVATAR_VERSION = 1;

// Twelve mid-tone hues that carry white initials in light and dark pages.
export const AVATAR_COLORS = [
  "#5b7fa6", // slate blue
  "#4f9a8a", // sea green
  "#8a6fb3", // violet
  "#c2724e", // clay
  "#3f8fb5", // lake
  "#a0744f", // walnut
  "#6f8f4f", // moss
  "#b55f7a", // rose
  "#4a8f9e", // teal
  "#9a7b3d", // ochre
  "#7a6fa8", // iris
  "#8c5f5f", // brick
] as const;

export type AvatarPerson = {
  id?: string | number | null;
  name?: string | null;
  email?: string | null;
  /** The stored image (a data URI), or null for initials. */
  avatar?: string | null;
};

export type Avatar = {
  /** The image to show, or null when initials stand in. */
  image: string | null;
  initials: string;
  /** Background behind the initials; the same for this person in every app. */
  color: string;
  /** What to call them on hover. */
  label: string;
};

export type AvatarHtmlOptions = {
  /** CSS size, e.g. "2rem" or "32px". Default 2rem. */
  size?: string;
  /** Extra class names beside `avatar`. */
  cls?: string;
  /** Element tag. Default span; Graphics' bar uses a button. */
  tag?: string;
  /** Extra attributes, already escaped (`id="mebtn" aria-haspopup="menu"`). */
  attrs?: string;
  /** Leave the initials background to the page's own CSS. Default false. */
  plain?: boolean;
  /** Put the name in `title`. Default true. */
  title?: boolean;
};

// "Joel Gaeddert" → JG. "Anna Lookabill Scott" → AS (first and last).
// One word → its first two letters. An email → the part before the @,
// read the same way ("anthony.esau" → AE). Nothing → "·".
export function avatarInitials(name?: string | null, email?: string | null): string {
  let s = String(name || "").trim();
  if (!s && email) s = String(email).split("@")[0].replace(/[._-]+/g, " ").trim();
  if (!s) return "·";
  const words = s.split(/\s+/).filter(Boolean);
  const out = words.length >= 2 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2);
  return out.toUpperCase();
}

// A stable color for a key (the person's id, or their name when there is
// no id). FNV-1a, so the same person lands on the same hue in every app.
export function avatarColor(key: string): string {
  let h = 0x811c9dc5;
  const s = String(key || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function avatarFor(p: AvatarPerson | null | undefined): Avatar {
  const name = String(p?.name || "").trim();
  const email = String(p?.email || "").trim();
  const image = p?.avatar && p.avatar.startsWith("data:image/") ? p.avatar : null;
  const key = p?.id != null && String(p.id) !== "" ? String(p.id) : name || email;
  return {
    image,
    initials: avatarInitials(name, email),
    color: avatarColor(key),
    label: name || email,
  };
}

export const AVATAR_CSS = `.avatar{--avatar-size:2rem;width:var(--avatar-size);height:var(--avatar-size);border-radius:50%;display:inline-grid;place-items:center;overflow:hidden;flex:none;padding:0;border:0;color:#fff;font-weight:600;font-size:calc(var(--avatar-size) * .38);line-height:1;letter-spacing:.02em;user-select:none;vertical-align:middle}
.avatar>img{width:100%;height:100%;object-fit:cover;display:block}`;

const STYLE_ID = "upland-avatar-css";

// Adds the base styles once per page, ahead of the app's own stylesheets
// so those still win. Safe to call anywhere; a no-op without a document.
export function ensureAvatarStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = AVATAR_CSS;
  document.head.prepend(style);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

// The one renderer: a round photo, or initials on the person's color.
export function avatarHtml(p: AvatarPerson | null | undefined, opts: AvatarHtmlOptions = {}): string {
  ensureAvatarStyles();
  const a = avatarFor(p);
  const tag = opts.tag || "span";
  const cls = `avatar${opts.cls ? ` ${opts.cls}` : ""}`;
  const style = [`--avatar-size:${opts.size || "2rem"}`, !a.image && !opts.plain ? `background:${a.color}` : ""].filter(Boolean).join(";");
  const title = opts.title === false || !a.label ? "" : ` title="${escapeHtml(a.label)}"`;
  const attrs = opts.attrs ? ` ${opts.attrs}` : "";
  const inner = a.image ? `<img src="${a.image}" alt="" draggable="false">` : escapeHtml(a.initials);
  return `<${tag} class="${cls}" style="${style}"${title}${attrs}>${inner}</${tag}>`;
}
