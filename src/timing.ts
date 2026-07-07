// ── Phase-shape timing model — SINGLE SOURCE OF TRUTH ────────────────────
// The firm-wide design/fab timing model. A project's labor is set by three
// numbers: total value (→ FTE-months), design heaviness D (design share of
// hours; D = 1 − split/100), and a month span. TIMING_DESIGN / TIMING_FAB
// say WHEN each team's hours land across the span — both are DERIVED below
// from TIMING_PROJECTS, the measured calibration set. Add a completed
// project there, bump TIMING_VERSION, tag the repo, and every consumer
// follows when it bumps its pin.
//
// Consumers (all via `@upland/shared/timing`, pinned by tag):
//   upland-scheduler lib/coaching.ts        — server require
//   upland-scheduler public/js/timing.js    — build-generated globals file
//   upland-odin      lib/retro.ts           — server require
//   upland-odin      public/js/timing.ts    — build-bundled re-export
//
// Recalibrating: edit TIMING_PROJECTS, bump TIMING_VERSION + package
// version, tag, then bump the pin in each app when ready. No hand-synced
// snapshots anywhere.

// Bumped whenever TIMING_PROJECTS (and therefore the derived templates)
// changes. Stamped into ODIN retros so a frozen snapshot records which
// model it was judged against.
export const TIMING_VERSION = "2026-07-07.8proj";

// ── Calibration projects (ODIN Toggl; method on the scheduler's Project
// Shape page). window: sustained-work start → INSTALL month, so step 9 =
// the install crunch, matching how the scheduler spans projects. d9/f9 =
// design/fab hours per ninth of the window (proportional-overlap resample
// of monthly hours, attributed by TEAM, leadership excluded).
// calib:false — shown on the Project Shape page but excluded from the
//   averages (fab-heavy outlier).
// fabCalib:false — excluded from TIMING_FAB only (KHEL's real install
//   happened ~14 months after the build, so its window has no install).
export interface TimingProject {
  n: string;
  client: string;
  window: string;
  M: number;
  sf?: number;
  budget?: number;
  note: string;
  calib?: boolean;
  fabCalib?: boolean;
  d9: number[];
  f9: number[];
}

export const TIMING_PROJECTS: TimingProject[] = [
  {
    n: "Japanese Hall",
    client: "Legacy of the Plains Museum",
    window: "2023-01..2024-04",
    M: 16,
    sf: 1200,
    budget: 285000,
    note: "flagship, multi-phase",
    d9: [77, 181, 117, 214, 196, 235, 322, 399, 158],
    f9: [65, 60, 142, 187, 123, 256, 601, 1149, 971],
  },
  {
    n: "Paris at War",
    client: "National WWI Museum and Memorial",
    window: "2025-01..2025-10",
    M: 10,
    sf: 3000,
    budget: 328000,
    note: "design-led",
    d9: [146, 155, 144, 221, 261, 277, 261, 158, 141],
    f9: [8, 86, 111, 87, 31, 20, 49, 312, 542],
  },
  {
    n: "Germans from Russia",
    client: "North Dakota State University",
    window: "2025-03..2026-05",
    M: 15,
    budget: 200000,
    note: "long design runway, late fab sprint",
    d9: [46, 63, 122, 59, 94, 99, 82, 192, 198],
    f9: [0, 0, 0, 0, 0, 0, 142, 564, 1056],
  },
  {
    n: "Armstrong",
    client: "IEEE History Center",
    window: "2023-11..2024-10",
    M: 12,
    sf: 800,
    budget: 147775,
    note: "balanced",
    d9: [19, 13, 65, 135, 178, 128, 210, 163, 132],
    f9: [91, 39, 1, 47, 233, 187, 117, 182, 145],
  },
  {
    n: "KHEL",
    client: "Kansas Dept. of Health & Env.",
    window: "2023-01..2023-11",
    M: 11,
    sf: 700,
    budget: 140000,
    note: "balanced",
    fabCalib: false,
    d9: [24, 86, 102, 207, 151, 115, 133, 98, 23],
    f9: [3, 8, 72, 327, 291, 93, 90, 64, 4],
  },
  {
    n: "Burlington Depot",
    client: "Willa Cather Foundation",
    window: "2025-09..2026-05",
    M: 9,
    budget: 144713,
    note: "design-led, light build",
    d9: [61, 54, 81, 79, 92, 126, 111, 41, 11],
    f9: [0, 0, 0, 0, 9, 21, 14, 99, 68],
  },
  {
    n: "Iowa Mobile",
    client: "State Historical Society of Iowa",
    window: "2024-02..2024-07",
    M: 6,
    sf: 300,
    budget: 119000,
    note: "compact, build-heavy",
    d9: [10, 33, 56, 48, 49, 50, 8, 6, 4],
    f9: [6, 14, 21, 31, 51, 71, 143, 90, 37],
  },
  {
    n: "WWI Soccer",
    client: "National WWI Museum and Memorial",
    window: "2025-11..2026-03",
    M: 5,
    budget: 100000,
    note: "compact, fast turnaround",
    d9: [33, 39, 65, 58, 47, 40, 35, 16, 11],
    f9: [0, 1, 6, 13, 25, 48, 64, 97, 105],
  },
  {
    n: "McPherson",
    client: "McPherson Museum",
    window: "2025-01..2025-05",
    M: 5,
    sf: 1000,
    budget: 170000,
    note: "fab-heavy, small design",
    calib: false,
    d9: [23, 27, 43, 43, 43, 32, 24, 16, 14],
    f9: [113, 106, 78, 91, 112, 95, 83, 104, 109],
  },
];

// ── Derivations ──────────────────────────────────────────────────────────
// Equal project weight: each project's step hours are normalised by its own
// window total before averaging, then the averaged curve is scaled to sum
// 100. Fab crests AT the install month — that comes straight out of the
// data now that windows are anchored on install.

export function projHours(p: TimingProject): number {
  return p.d9.reduce((a, b) => a + b, 0) + p.f9.reduce((a, b) => a + b, 0);
}

function timingTemplate(projs: TimingProject[], key: "d9" | "f9"): number[] {
  const acc = Array(9).fill(0);
  for (const p of projs) {
    const tot = projHours(p);
    for (let s = 0; s < 9; s++) acc[s] += p[key][s] / tot / projs.length;
  }
  const sum = acc.reduce((a, b) => a + b, 0);
  return acc.map((v) => (100 * v) / sum);
}

export const TIMING_CALIB = TIMING_PROJECTS.filter((p) => p.calib !== false);
export const TIMING_DESIGN = timingTemplate(TIMING_CALIB, "d9");
export const TIMING_FAB = timingTemplate(
  TIMING_CALIB.filter((p) => p.fabCalib !== false),
  "f9",
);

// Firm-default fab share (%) when a project hasn't set one.
export const STD_SPLIT = Math.round(
  100 -
    TIMING_CALIB.reduce((a, p) => a + (100 * p.d9.reduce((x, y) => x + y, 0)) / projHours(p), 0) /
      TIMING_CALIB.length,
);

// ── Reads of the model ───────────────────────────────────────────────────

const _resampleCache = new Map<string, number[]>();
// Resample a 9-point template (centred at (i+.5)/9) onto `len` month
// buckets, renormalised to sum 1. Cached by template content + len.
export function resampleTiming(tpl: number[], len: number): number[] {
  if (len <= 1) return [1];
  const key = tpl.join(",") + "|" + len;
  const hit = _resampleCache.get(key);
  if (hit) return hit;
  const out: number[] = [];
  for (let mo = 0; mo < len; mo++) {
    let x = ((mo + 0.5) / len) * 9 - 0.5;
    x = Math.max(0, Math.min(8, x));
    const i = Math.floor(x);
    out.push(tpl[i] + (tpl[Math.min(8, i + 1)] - tpl[i]) * (x - i));
  }
  const s = out.reduce((a, b) => a + b, 0);
  const norm = out.map((v) => v / s);
  _resampleCache.set(key, norm);
  return norm;
}

// Interpolate a 9-point template at fractional position t ∈ [0,1] (no
// renormalisation) — for drawing the continuous timing-shape curves.
export function interpTiming(tpl: number[], t: number): number {
  let x = t * 9 - 0.5;
  x = Math.max(0, Math.min(8, x));
  const i = Math.floor(x);
  return tpl[i] + (tpl[Math.min(8, i + 1)] - tpl[i]) * (x - i);
}

// Cumulative share of a template's hours spent by fraction t of the span:
// trapezoid-integrate the interpolated template once into a lookup table,
// normalised so the full span sums to 1.
const CUM_STEPS = 256;
const _cumCache = new Map<number[], number[]>();
export function cumShare(tpl: number[], t: number): number {
  let cum = _cumCache.get(tpl);
  if (!cum) {
    cum = [0];
    for (let i = 1; i <= CUM_STEPS; i++) {
      const a = interpTiming(tpl, (i - 1) / CUM_STEPS);
      const b = interpTiming(tpl, i / CUM_STEPS);
      cum.push(cum[i - 1] + (a + b) / 2);
    }
    const total = cum[CUM_STEPS];
    for (let i = 0; i <= CUM_STEPS; i++) cum[i] /= total;
    _cumCache.set(tpl, cum);
  }
  const x = Math.max(0, Math.min(1, t)) * CUM_STEPS;
  const i = Math.floor(x);
  return cum[i] + (cum[Math.min(CUM_STEPS, i + 1)] - cum[i]) * (x - i);
}

// Expected cumulative fraction of a project's total labor spent by
// fraction t of its schedule. `split` is the scheduler's fab share %
// (5–95, null → firm standard). The curve reaches 100% at install; the
// scheduler's small post-install closeout indicator is added separately
// by consumers that want it.
export function expectedBurn(t: number, split: number | null): number {
  const design = 1 - (split != null ? split : STD_SPLIT) / 100;
  return design * cumShare(TIMING_DESIGN, t) + (1 - design) * cumShare(TIMING_FAB, t);
}
