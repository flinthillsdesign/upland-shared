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
