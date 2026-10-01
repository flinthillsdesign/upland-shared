# @upland/shared

Shared modules for the Upland Exhibits app suite. One repo, one package,
subpath modules — consumed as a tag-pinned git dependency so updates are
deliberate:

```json
"@upland/shared": "github:flinthillsdesign/upland-shared#v0.1.0"
```

## Modules

- **`@upland/shared/timing`** — the firm-wide design/fab phase-shape timing
  model. `TIMING_PROJECTS` (the measured calibration set) is the source of
  truth; `TIMING_DESIGN` / `TIMING_FAB` / `STD_SPLIT` are derived from it.
  Also the reads: `resampleTiming`, `interpTiming`, `cumShare`,
  `expectedBurn`, and `TIMING_VERSION` (stamped into ODIN retros).

  Recalibrating: edit `TIMING_PROJECTS`, bump `TIMING_VERSION` and the
  package version, tag, then bump the pin in each app when it's ready.

- **`@upland/shared/months`** — the absolute-month-key convention the
  scheduler and ODIN share.
- **`@upland/shared/palette`** — the design/fab team colors.
- **`@upland/shared/dates`** — Upland days are Kansas days. `centralToday`,
  `centralDay`, `centralDayPlus`, `formatCentral`, and `parseStamp` (a stored
  SQLite timestamp is UTC, not local time). Safe in the browser.
- **`@upland/shared/mail`** — `sendMail`, the one Postmark sender: links never
  rewritten, opens never tracked, one From shape, never throws, and "not
  configured" is not "sent". No dependency (fetch). Server only.
- **`@upland/shared/db`** — `withRetry`: one retry for a dropped Turso
  connection, every argument passed through. Server only.

Planned next: `contracts` (cross-app API shapes: project registry, retro_v1,
scheduler feed) and `voice` (the durable Upland style guide + prompt
fragments for AI features).

## Consumers

| App | Server | Frontend |
|---|---|---|
| upland-scheduler | `lib/coaching.ts` require | `public/js/timing.js` generated at build (globals) |
| upland-odin | `lib/retro.ts` require | `public/js/timing.ts` re-export, bundled at build |

Frontends can't import node_modules at runtime (both apps serve unbundled
ES modules / classic scripts), so each app's `build.js` bakes this package
into its browser timing file. Server code requires it directly — Netlify
bundles function dependencies.
