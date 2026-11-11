# CLAUDE.md: Loadout

Loadout: RPG-styled team meeting-load planner; drag people onto weekly meeting puzzle-blocks, weighted meeting-hours fill a bottle meter, insight engine flags overload/duplicates/oversized meetings (loadout.neorgon.com)

**Live:** loadout.neorgon.com · **Port:** 8850

## Run

```bash
make serve
```

Then open http://localhost:8850. It must be served over HTTP. The app is ES modules, and `file://` blocks them.

## Architecture

| Module | Owns |
|---|---|
| `js/events.js` | `bindEvents`: drag, click delegation, keyboard, drawer, focus kept across redraws |
| `js/state.js` | `STORAGE_KEY`, `state`, `ui`, people/weeks/meetings mutations, `loadState`, undo |
| `js/validate.js` | `cleanState` and the field cleaners: the one gate for stored and imported values |
| `js/render.js` | `render` and its parts; every interpolated value escaped |
| `js/settings.js` | `initWorkspace`, `addTeam`, `workspace`: the Neorgon Workspace wiring |
| `js/team-adapter.js` | `pickTeam`, `planAdd`, `toWorkspace`, `weeklyHours`, `face` (pure) |
| `js/insights.js` | `computeInsights` |
| `js/load.js` | the weighted meeting-hours model |
| `js/data.js` | `DAYS`, `RECURRENCE`, `MEETING_TYPES`, `TYPE_ORDER`, `PRESETS`, `CLASS_COLORS` |
| `js/utils.js` | `genId`, `clamp`, `escHtml`, `debounce`, `fmtHours`, `showToast`, `$` |
| `js/app.js` | wiring only |

Vendored from `packages/neorgon-ui/`, never edited in place: `js/neorgon-{header,footer,dom,persist}.js`, `js/neorgon-workspace*.js`, `css/neorgon-*.css`. The workspace kit: `packages/neorgon-ui/sync-workspace.sh --to loadout-site`.

## Data

Persisted in this browser:

- `localStorage['loadout-v1']`: people (`{ id, name, color, ws? }`, `ws` being the Workspace person id), weeks, meetings, the current week and settings. Read only through `cleanState` (js/validate.js).
- `localStorage['neo-ws:cache']`, `neo-ws:comma-off`, `sessionStorage['neo-ws:return-hash']`: the Workspace kit's.
- Cookies `neo_me` (the visitor's settings, shared by every Neorgon tool) and `neo_ws` (a stamp), both written by the kit.

`settings.workHours` is not a preset value: it comes from `neo_me` (working hours times work days, `weeklyHours`), and only the percentage in the overload signal reads it.

## Tests

- `make test`: `node --test tests/*.test.mjs` (validation, escaping, the adapter).
- `node tests/workspace-browser.mjs [chromium,firefox,webkit]`: Playwright from the monorepo root; starts Loadout on 9370 and neorgon-site (the frame) on 9371 itself. It also maps loadout.neorgon.com and neorgon.com onto those servers in Chromium to check that no analytics script runs while the address carries `neo-ws=`.

## Conventions

- Zero build step. Plain ES modules loaded by `js/app.js`.
- Header and footer come from the shared kits. Do not add site-local `.neo-footer` or `.header-bar` CSS.
- No single JS file over 500 lines (events.js is the largest, under 490).

## Gotchas

- Everything renders through template strings and `innerHTML`. Before 2026-11-11 ids, colours and meeting types went into attributes and styles unescaped and `loadState` trusted localStorage; workspace people are untrusted, so both walls now exist. Keep both: a new field gets a cleaner in `validate.js` and `esc()` in `render.js`.
- A redraw replaces every control, so `commit()` finds the focused one again by its data attributes. A new control that changes state needs a `data-*` key in `FOCUS_KEYS` (events.js) or keyboard users lose their place.
- Pressing the current week's tab renames it; that is the keyboard and touch path to rename, not a bug.
- The Header Kit's analytics run only on `*.neorgon.com`, so the beacon check needs the routed production hosts in the browser test; a plain localhost run proves nothing about it.
- **`js/app.js` loads before `neorgon-header.js` in `index.html`, and that order is the analytics rule.** Both are deferred, so they run in document order: the module's `NeoWorkspace.init` strips a pick's `#neo-ws=` answer before the Header Kit appends GoatCounter and Cloudflare's beacon. Rama, Floorplan, Reparto and Client Says hold the answer back with an inline script instead (`window.__neoWsAnswer`); Loadout needs none as long as the module stays first. Move the header script above it and the beacon sees the team.
- A chip's `ws` is a hint, not a fact. The Workspace review may merge a saved chip into a person under that person's own id, so nothing writes `ws` at save time; `planAdd` treats a chip whose `ws` the workspace does not hold as loose and links it by its saved id (`loadout-<id>`), then by an unambiguous name.
- Declining the large-team question still closes the kit's banner (or sheet): the kit ignores what `use.run` returns, so `addTeam` toasts that the offer stays in Settings.
- Saves are debounced 300ms (`debouncedSave` in state.js) and flushed on `pagehide` and on a hidden tab (`bindSaveFlush`, called from app.js). A new save path calls `debouncedSave`, never its own timer, or a reload drops it again.
- "Add my team" asks with `confirm()` before adding more than `CONFIRM_OVER` (40) people at once (`confirmAddText`); times in Settings go through `fmtClock`, which follows the Workspace time format (`neo_me.c`).
- With a mouse, a chip's remove button is laid over the chip's right edge (`@media (hover: hover)`), so a hidden one holds no width in the 232px rail. While it shows (hover or focus-within) `.chip-main` takes 34px of right padding so the name's ellipsis ends before it, and its backing is an opaque `color-mix` (`--surface-2` is 6% white and let the name show through). On touch it stays in flow at 44px.
- On touch, a meeting face's remove badge is hidden until that face is tapped (`armSeat` in events.js, `.seat--armed`); a badge on every face covered the initials.

## Do not touch

- `js/neorgon-*.js` and `css/neorgon-*.css`: vendored kits, regenerated by `packages/neorgon-ui/sync-*.sh`.
