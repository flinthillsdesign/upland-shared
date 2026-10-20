// ── Fresh: a page left open comes back current ───────────────────────────
// Every Upland app fetched its data once when a page opened and trusted it
// from then on. An installed app window (or a pinned tab) stays open for
// days, so the scheduler showed Joel a board from before three projects
// were signed, and the heatmap he remembered was a week old (2026-10-19).
//
// `watchFresh` runs in every page. Whenever the window comes back to the
// foreground (and, while it stays visible, every few minutes) it asks two
// questions:
//
//   1. Is the running build still the deployed one? Each app's build writes
//      `public/build.json` with the moment it was built. A different answer
//      means a deploy happened: reload the page.
//   2. Has the data moved? A page can hand over a `stamp` (the server's
//      updated-at for what it shows) and a `refresh` that re-reads in place.
//      Without a stamp, a page that was hidden for a while is simply
//      reloaded on return.
//
// Neither ever throws work away: nothing reloads while the page is `dirty`
// (by default, an edit in the last ten minutes). Instead the reload button
// lights up and says a newer version is waiting. The button itself appears
// only in installed-app windows, which have no address bar to reload from
// (Cmd+R still works there too).
//
// Browser only. No dependencies. Safe to import in a server bundle (it does
// nothing without a `document`).

export type FreshOptions = {
  /** Where the build stamp lives. Default "/build.json". */
  buildUrl?: string;
  /** The data's updated stamp (any string). Different from last time = data moved. */
  stamp?: () => Promise<string | null | undefined>;
  /** Re-read the data in place. Default: reload the page. */
  refresh?: () => Promise<void> | void;
  /** Unsaved work on the page? Default: an edit in the last `dirtyMs`. */
  dirty?: () => boolean;
  /** How long after the last edit the page still counts as dirty. Default 10 min. */
  dirtyMs?: number;
  /** A page with no stamp reloads on return after being hidden this long. Default 10 min. */
  idleMs?: number;
  /** While visible, check this often. Default 5 min. */
  pollMs?: number;
  /** Show the reload control in installed-app windows. Default true. */
  button?: boolean;
};

export type FreshHandle = {
  /** Change the watcher after it started (a page adds its stamp once it knows it). */
  configure(opts: FreshOptions): void;
  /** Run a check now. */
  check(): Promise<void>;
  /** Tell the watcher about unsaved work by hand. */
  markDirty(): void;
  markClean(): void;
  /** The build stamp this page started with (null until known). */
  readonly build: string | null;
};

export type BuildInfo = { built_at: string; ref?: string | null };

const MIN = 60 * 1000;
const DEFAULTS = { dirtyMs: 10 * MIN, idleMs: 10 * MIN, pollMs: 5 * MIN };
// At most one check this often, however many events fire together.
const CHECK_GAP_MS = 15 * 1000;

// ── The decision, kept pure so it can be tested without a browser ────────
export type FreshState = {
  build: string | null;
  stamp: string | null;
  hiddenSince: number | null; // ms epoch, while hidden
  lastRefresh: number; // ms epoch
  dirty: boolean;
  hasStamp: boolean;
};
export type FreshReading = { build: string | null; stamp: string | null; now: number };
export type FreshDecision = "reload" | "refresh" | "wait" | "none";

export function decide(
  state: FreshState,
  reading: FreshReading,
  idleMs: number = DEFAULTS.idleMs,
): FreshDecision {
  // A new build: the page itself is old.
  if (state.build && reading.build && reading.build !== state.build) {
    return state.dirty ? "wait" : "reload";
  }
  if (state.hasStamp) {
    if (state.stamp != null && reading.stamp != null && reading.stamp !== state.stamp) {
      return state.dirty ? "wait" : "refresh";
    }
    return "none";
  }
  // No stamp to compare: a page hidden long enough is assumed stale.
  const hiddenFor = state.hiddenSince != null ? reading.now - state.hiddenSince : 0;
  if (hiddenFor >= idleMs && reading.now - state.lastRefresh >= idleMs) {
    return state.dirty ? "wait" : "reload";
  }
  return "none";
}

// ── The watcher ──────────────────────────────────────────────────────────
export function watchFresh(opts: FreshOptions = {}): FreshHandle {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return noopHandle();
  }
  const w = window as any;
  if (w.__uplandFresh) {
    (w.__uplandFresh as FreshHandle).configure(opts);
    return w.__uplandFresh;
  }

  let o: Required<Pick<FreshOptions, "buildUrl" | "dirtyMs" | "idleMs" | "pollMs" | "button">> &
    FreshOptions = {
    buildUrl: "/build.json",
    button: true,
    ...DEFAULTS,
    ...opts,
  };
  let build: string | null = null;
  let stamp: string | null = null;
  let lastRefresh = Date.now();
  let hiddenSince: number | null = document.visibilityState === "hidden" ? Date.now() : null;
  let lastEdit = 0;
  let forcedDirty = false;
  let lastCheck = 0;
  let pending: "build" | "data" | null = null;
  let checking: Promise<void> | null = null;

  const isDirty = () => {
    if (forcedDirty) return true;
    if (o.dirty) return !!o.dirty();
    return Date.now() - lastEdit < o.dirtyMs;
  };

  async function readBuild(): Promise<string | null> {
    try {
      const res = await fetch(o.buildUrl + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return null;
      const info = (await res.json()) as BuildInfo;
      return info && info.built_at ? String(info.built_at) : null;
    } catch {
      return null;
    }
  }
  async function readStamp(): Promise<string | null> {
    if (!o.stamp) return null;
    try {
      const s = await o.stamp();
      return s == null ? null : String(s);
    } catch {
      return null;
    }
  }

  async function doRefresh() {
    if (o.refresh) await o.refresh();
    else location.reload();
    lastRefresh = Date.now();
    pending = null;
    paintButton();
  }

  async function runCheck(force = false) {
    if (checking) return checking;
    const now = Date.now();
    if (!force && now - lastCheck < CHECK_GAP_MS) return;
    lastCheck = now;
    checking = (async () => {
      const [b, s] = await Promise.all([readBuild(), readStamp()]);
      if (build == null && b != null) build = b; // first sight of the build
      if (stamp == null && s != null && pending !== "data") stamp = s;
      const d = decide(
        { build, stamp, hiddenSince, lastRefresh, dirty: isDirty(), hasStamp: !!o.stamp },
        { build: b, stamp: s, now: Date.now() },
        o.idleMs,
      );
      if (d === "reload") {
        location.reload();
      } else if (d === "refresh") {
        stamp = s;
        await doRefresh();
      } else if (d === "wait") {
        pending = build && b && b !== build ? "build" : "data";
        paintButton();
      } else if (pending && !isDirty()) {
        // Work was finished since we last waited: act on what we saw.
        if (pending === "build") location.reload();
        else {
          stamp = s;
          await doRefresh();
        }
      }
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  // ── Events ──
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenSince = Date.now();
    } else {
      void runCheck().finally(() => {
        hiddenSince = null;
      });
    }
  });
  window.addEventListener("focus", () => void runCheck());
  window.addEventListener("pageshow", (e: any) => {
    if (e && e.persisted) void runCheck(true);
  });
  const editEvents = ["input", "change"];
  for (const ev of editEvents) document.addEventListener(ev, () => (lastEdit = Date.now()), true);
  document.addEventListener(
    "keydown",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
        lastEdit = Date.now();
      }
    },
    true,
  );
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") void runCheck();
  }, o.pollMs);
  window.addEventListener("pagehide", () => clearInterval(timer));

  // ── The reload control, installed-app windows only ──
  let btn: HTMLButtonElement | null = null;
  function standalone(): boolean {
    try {
      return (
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
        (navigator as any).standalone === true
      );
    } catch {
      return false;
    }
  }
  function mountButton() {
    if (!o.button || btn || !standalone()) return;
    const style = document.createElement("style");
    style.id = "upland-fresh-style";
    style.textContent = `
.upland-fresh{position:fixed;right:14px;bottom:14px;z-index:2147483000;width:34px;height:34px;border-radius:50%;
 border:1px solid rgba(128,128,128,.35);background:rgba(128,128,128,.18);color:inherit;font:18px/1 system-ui,sans-serif;
 cursor:pointer;opacity:.55;transition:opacity .15s;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:0}
.upland-fresh:hover{opacity:1}
.upland-fresh.pending{opacity:1;background:#c8102e;border-color:#c8102e;color:#fff;animation:upland-fresh-pulse 1.6s ease-in-out infinite}
@keyframes upland-fresh-pulse{0%,100%{box-shadow:0 0 0 0 rgba(200,16,46,.5)}50%{box-shadow:0 0 0 8px rgba(200,16,46,0)}}
@media print{.upland-fresh{display:none}}`;
    document.head.appendChild(style);
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "upland-fresh";
    btn.textContent = "↻";
    btn.title = "Reload";
    btn.setAttribute("aria-label", "Reload");
    btn.addEventListener("click", () => location.reload());
    document.body.appendChild(btn);
    paintButton();
  }
  function paintButton() {
    if (!btn) return;
    if (pending) {
      btn.classList.add("pending");
      btn.title =
        pending === "build"
          ? "A newer version is deployed. Reload when you're done."
          : "This page has changed on the server. Reload when you're done.";
    } else {
      btn.classList.remove("pending");
      btn.title = "Reload";
    }
  }
  if (document.body) mountButton();
  else document.addEventListener("DOMContentLoaded", mountButton);

  // First sight of the build and the stamp, so later checks have a baseline.
  void runCheck(true);

  const handle: FreshHandle = {
    configure(next) {
      o = { ...o, ...next };
      if (next.stamp) {
        // A stamp arriving later: take its baseline now.
        void readStamp().then((s) => {
          if (s != null) stamp = s;
        });
      }
      mountButton();
    },
    check: () => runCheck(true) || Promise.resolve(),
    markDirty() {
      forcedDirty = true;
    },
    markClean() {
      forcedDirty = false;
      lastEdit = 0;
    },
    get build() {
      return build;
    },
  };
  w.__uplandFresh = handle;
  return handle;
}

function noopHandle(): FreshHandle {
  return {
    configure() {},
    check: async () => {},
    markDirty() {},
    markClean() {},
    build: null,
  };
}
