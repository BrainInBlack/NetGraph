# Architecture

This document describes NetGraph's architecture, conventions, and the reasoning
behind its trickier subsystems. Read it before changing routing, persistence, or
anything that ingests untrusted data.

## What this is

A browser-based local network visualizer. Users manually map a home/lab network by adding devices and connections. All data lives in `localStorage` - no backend, no accounts, no telemetry. Target user: enthusiast, not a sysadmin.

## Commands

```sh
npm install          # one-time
npm run dev          # Vite dev server on :5173 with HMR
npm run build        # tsc + both builds: dist/ (multi-file) + dist/download/netgraph.html (single-file)
npm run build:web    # multi-file build only -> dist/
npm run build:single # single-file build only -> dist/download/netgraph.html
npm run preview      # serve the production build
npm test             # vitest run - single pass
npm run test:watch   # vitest in watch mode
```

The build output is plain static files: deploy by serving `dist/` from any
webserver, or hand someone the single-file `dist/download/netgraph.html`.

Tests run on **vitest** with the **happy-dom** environment (`vitest.config.ts`); test files are `src/**/*.test.ts`. Coverage focuses on pure / pure-ish modules - `parse-shapes`, `svg-sanitizer`, `path-geometry`, `collision`, `route`, `import-export`, `storage`, `graph/layout`, `ui/clipboard`, and the `util` helpers. DOM/pointer-heavy code (`renderer`, `zoom`, `connect-mode`, `select-mode`, `ui/*` modals) is not unit-tested. There's no linter beyond `tsc` - `tsconfig.json` runs with `strict`, `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch`, so a clean `npx tsc --noEmit` plus passing `npm test` is the bar.

Vite needs `lucide-static` and `sass` as peer deps; both are pinned in `package.json`.

## High-level architecture

Vanilla TypeScript SPA, single entry at `src/ts/main.ts`. No framework. State lives in module-scope variables; the DOM is the renderer.

### State flow

`src/ts/state.ts` is the single source of truth.

```
user action  ->  caller mutates state.maps/devices/links  ->  setState(state)
                                                              ↓
                                          saveState() (localStorage)
                                                              ↓
                                          scheduleRender() - rAF-coalesced
                                                              ↓
                                                  render() -> renderAll(map, sel)
                                                              ↓
                                                  hooks.onAfterRender()
```

Callers follow a deliberately simple mutate-then-`setState` pattern: `getState()` returns the live reference, the caller mutates it directly (`state.maps.push(...)`), then calls `setState(state)` to trigger save + render. This is concise but means *the state has already changed by the time `setState` runs* - real rollback on quota errors isn't possible without a much bigger refactor.

**Render coalescing.** `setState` and `setSelectedDeviceId` don't render synchronously - they call `scheduleRender()`, which dedupes every request in the same tick into one `requestAnimationFrame` callback. So a single user action that mutates state *and* changes selection renders once, not twice, and a drag's multiple `pointermove`s per frame collapse to one `renderAll`. The bare `render()` export stays synchronous for the init path, which reads laid-out geometry (`centerContent`) immediately after rendering and can't wait for a frame.

**Hooks (`state.setHooks`)** are how the renderer talks back to the UI without creating a circular import. `main.ts` wires `onDeviceClick`, `onDeviceContextMenu`, and `onAfterRender` at init. The renderer fires `onDeviceClick(id)` from a card click; main.ts's hook implementation opens the panel. Anything that wants to react to *every* re-render (panel refresh after edits, etc.) lives in `onAfterRender`.

### Render pipeline (`src/ts/graph/renderer/`)

The renderer is split into `index.ts` (`renderAll` - the only export), `devices.ts` (device cards + drag), `connections.ts` (connection groups + SVG), and `geom.ts` (`DeviceGeom`, `readDeviceGeom`, endpoint fan-out math).

Runs on every `setState` - and during device drags, at every `pointermove` (~60 fps, coalesced to one render per frame by `scheduleRender`). Three optimizations make this viable:

1. **Device diff/reuse**: existing `.device` DOM elements are indexed by id in a single `querySelectorAll` pass (a `Map<id, el>` reused for both the removal sweep and per-device lookup - replacing the old per-device `querySelector` that made the whole render O(n²)). Elements are reused across renders; only `style.left/top` updates unconditionally. The drag handler also captures the dragged device's element once at `pointerdown` rather than re-finding it every frame.
2. **Content hash**: `deviceContentHash(device, map)` covers every field that affects the card's `innerHTML` (excluding position). Stored on `dataset.contentHash`. If the hash matches the last render's, `innerHTML` rewrite is skipped - so a drag (which only mutates x/y) does zero innerHTML work per frame.
3. **Connection diff/reuse**: SVG `<g>` elements are created once per link and only their `d` / `x` / `y` attributes update per render. Listeners attached at creation persist. Per-render `geomCache` makes device-geometry reads (`readDeviceGeom`) one-DOM-read-per-device-per-frame instead of one-per-link.

The detail panel (`src/ts/ui/sidebar.ts openPanel`) uses the same hash trick (`panelContentHash`) so dragging a selected device doesn't churn the side panel innerHTML 60x/sec.

### Connection routing

Path geometry is split across three pure modules plus the renderer:

- **`src/ts/graph/path-geometry.ts`** - `pathSegments()` returns a connection's axis-aligned skeleton: Z (3 segments) when both attach sides share an axis, L (2) for mixed axes, straight (1) when the perpendicular distance is below `MIN_PERPENDICULAR` (16 px). `segmentsToPath()` serializes that skeleton to an SVG `d` string with rounded Q corners. `labelAnchor()` computes label position for any segment count (straight, L, Z, or detour), centered on the *visible* span between the cards - it takes `startInset`/`endInset` (the path length hidden under each endpoint card) so the label sits in the middle of the gap, not pulled toward the larger node. `axisOf()` / `signOf()` are the shared side->axis and side->direction helpers.
- **`src/ts/graph/collision.ts`** - `segmentIntersectsRect`, `pathCollidesWith`, and `pathCollidesExcluding` (the last skips two endpoint rects by reference, so a path may legitimately start/end inside its own cards). Pure axis-aligned-geometry helpers.
- **`src/ts/graph/route.ts`** - `routeConnection()` wraps `pathSegments` with collision avoidance *and* face-away geometry handling. Order of operations: face-away short-circuit (`isFaceAway` -> `uShapeFaceAway`) -> default path -> bend-nudge -> multi-segment detour (Z or L variant). Pure function; it takes `allRects` (every device rect, built once per render and shared across all links) and skips the two endpoint rects by reference - the per-link obstacle list is materialized only when needed. Returns `{ segs, collides }` so the renderer flags residual collisions without re-scanning. Exit/entry points are pushed past overlapping obstacles via `pushPast`.
- **`renderer/connections.ts updateConnectionGroup`** - picks attach sides + bend position, then draws via `routeConnection(...)` -> `segmentsToPath()`.

Key behaviors:

- **Endpoints stay at card centers** so the line visually attaches at the perimeter (cards cover the line ends).
- **Bend position** is computed from card *edges* (`center +/- halfSize`), not centers, so the bend sits in the gap between cards even when card heights differ. If card edges cross on the projection axis (the face-away case), the renderer falls back to the midpoint of centers - but `route.ts` detects the same condition and routes a U-shape, so this fallback is effectively dead code that never reaches the user.
- **Straight-line fallback**: below `MIN_PERPENDICULAR` (16 px) perpendicular distance, the path collapses to a single straight horizontal/vertical segment - no tiny S-curve.
- **Lined-up straightening** (`renderer/connections.ts updateConnectionGroup`): for a *facing* same-axis connection, if the two cards overlap on the perpendicular axis - inset by `MIN_PERPENDICULAR` so the line lands on the flat part of each edge, not a rounded corner - both endpoints snap to the shared overlap midpoint, so a visually lined-up pair draws a straight segment instead of a small jog. The tolerated misalignment scales with card size (a tall card stays straight across a wider offset than a short one). Skipped when fan-out has spread the side's links along the perpendicular axis.
- **Endpoint fan-out** (`computeEndpointOffsets`): when multiple connections meet at the same card side, they spread along the perpendicular axis with `ENDPOINT_GAP` (6 px) so they don't overlap.
- **Connection labels** are positioned by `labelAnchor()` at the middle of the *visible* span (see above) and rendered with a feathered SVG filter (`<feMorphology>` + `<feGaussianBlur>` + `<feFlood>`) for readability over any background. They're hover-revealed (`opacity: 0` until `.conn-group:hover`/`.active`).
- **Collision avoidance** (`route.ts`): connections actively route around non-endpoint device cards. Z-shapes try bend-nudge (shift bend to obstacle edges, closest-first) then 5-segment detour (exit past obstacles, jog perpendicular, cross, jog back, enter). L-shapes try nudge-to-3-segment (promote L into a Z-like path at obstacle edges along both axes) then 4-segment detour (exit past source obstacles, jog perpendicular, cross to target column/row, enter). Inner segments are validated collision-free; first/last segments under endpoint cards are tolerated (cards physically overlapping is a layout issue, not a routing failure). The `.conn-collision` flag (amber dashed line) is driven by the `collides` field `routeConnection` returns - set for any residual collision the router can't fully resolve.
- **Face-away routing** (`route.ts uShapeFaceAway`): when `sourceSide` and `targetSide` share an axis and point in directions that would put the Z-shape bend *inside* the cards (`isFaceAway`), `routeConnection` short-circuits to a 5-segment U-shape that exits past each card's chosen edge, jogs perpendicular (above the higher top or below the lower bottom of both endpoint rects, plus any obstacle-edge candidates), and re-enters from the other side. This is what makes manually-picked sides like source='left' + target='right' (with target to the right of source) render correctly instead of bending through the cards.

### Data validation & persistence

`src/ts/parse-shapes.ts` is the single source of truth for "what is a valid Device/Link/Map/CustomIcon". It's called from two places:

- `storage.ts migrate()` - when loading from `localStorage` on startup
- `import-export.ts parseImport()` - when the user imports a JSON file

Per-field caps are defined once (name, ip, mac, tags, etc.); SVG custom icons always go through `svg-sanitizer.ts`. There's no path where untrusted SVG content reaches the DOM without sanitization.

**ID validation (`validateId`).** Every id read from an untrusted bundle (device, link `id`/`sourceId`/`targetId`, map, custom-icon) is run through `validateId`, which enforces `ID_PATTERN` (`/^[a-zA-Z0-9_\-:]{1,128}$/`) and returns `null` on a miss - rejecting the record at ingest. This closes an attribute-injection XSS: ids are interpolated into `data-*` attributes, so a crafted id could otherwise break out of the attribute. `escapeHtml(...)` is also applied at every id sink (sidebar, toolbar, icon-manager, icon-picker, modals) as defense-in-depth, so neither layer is load-bearing alone.

`svg-sanitizer.ts` is allow-list based: only specific SVG tags pass through, attributes are validated per-tag, `url(...)` references in paint/style attributes must be `#fragment` only (no `http://`, `data:`, `javascript:`). The url-value check also rejects CSS escapes (a backslash - `\75rl(` reconstructs `url(`) and bare-url CSS functions (`image-set`, `image`, `cross-fade`, `element`), which slip past a literal-`url(` scan.

**mXSS defense - the walk must visit *all* child nodes, not just elements.** We parse as `image/svg+xml` (XML) but the app reinserts the result via `innerHTML` (HTML). A CDATA section or comment is inert in XML, survives `outerHTML` serialization intact, and on HTML re-parse can break out into live markup (e.g. `<title><![CDATA[</title><img onerror=...>]]></title>` yields a live `<img>` in Chromium). So the sanitizer walks `childNodes` and drops everything that isn't an allow-listed element or a plain text node (text is safe - serialization escapes it). Never narrow this back to `.children`.

`sanitizeSvg` also enforces `MAX_SVG_LENGTH` (64 KB) on the source string and returns `null` if exceeded - the single size chokepoint for both ingest paths. Raster uploads have a separate, larger pre-downscale cap in `icon-upload.ts` (`IMAGE_MAX_BYTES`, 256 KB). `icon-upload.ts` is the shared module that the icon picker and the Manage Icons modal both consume - `readFileAsIcon` parses + sanitizes + downscales in one place so both flows produce identical `CustomIcon`s.

### Modals & overlays

Two flavors:

- **Single primary modal**: `#modal-overlay` in `index.html`. Used by `showModal()` in `modals/shared.ts` for one-at-a-time dialogs (Edit Device, Delete Confirm, New Map, etc.). Each dialog lives in its own file under `src/ts/ui/modals/`; `modals/index.ts` wires the `netgraph:*` events to them.
- **Stacked overlays**: created dynamically via `ensureStackedOverlay(id, zIndex)` in `util.ts`. Used by the icon picker, icon manager, and import flow - they need to sit *on top* of an existing modal without clobbering it.

Both pull `body.modal-active` via `pushModalLock` / `popModalLock`, which use a counter so nested modals work correctly. Z-index values are coordinated between TS (`Z_*` constants in `util.ts`) and SCSS (`$z-*` in `_variables.scss`).

All modals are focus-trapped via `trapFocus(container)` and have `role="dialog"` + `aria-modal="true"`.

**Backdrop dismiss with selection-overshoot guard** (`bindOverlayDismiss` in `util.ts`). Every overlay (`#modal-overlay`, icon-picker, icon-manager) wires its click-to-dismiss through this helper. It tracks the `pointerdown` target and only dismisses if both the pointerdown *and* the click landed on the overlay itself - otherwise a text-selection drag that started inside the dialog and ended outside it (release on the gap around the modal) would trigger a click whose `target` is the overlay (the common ancestor of mousedown + mouseup) and close the dialog. Always use this helper when adding a new overlay; do not hand-roll the `e.target === overlay` check.

**ARIA radiogroup keyboard nav** (`bindRadioGroupKeys` in `util.ts`). Segmented controls in the device editor (card width) and connection editor (link type) are `role="radiogroup"` with `<button role="radio">` children. The helper wires arrow keys (+ Home / End) onto them so they're keyboard-navigable - Tab still walks each button too. Click handlers stay separate and own the `aria-checked` update.

### Touch / pointer model

Everything routes through pointer events - no separate touch handlers. Three patterns:

- **Drag** (`renderer/devices.ts attachDeviceDragHandlers`): per-element pointer capture, threshold scales with `pointerType` (3 px mouse, 8 px touch).
- **Pan + pinch** (`zoom.ts`): canvas tracks `activePointers` Map; 1 pointer = pan, 2 pointers = pinch zoom anchored on midpoint.
- **Long-press** (`util.ts createLongPress`): touch-only substitute for right-click. Wired into device cards, connection lines, and the empty canvas - fires `onDeviceContextMenu` / `netgraph:connection-context-menu` / `showCanvasContextMenu` after 500 ms hold.

`#canvas` has `touch-action: none` so the browser doesn't fight our gesture handling.

### Cross-module events

Everything UI-level talks via `document.dispatchEvent(new CustomEvent('netgraph:...', { detail }))`. Conventions:

| Event | Payload | Fired from | Handled in |
|-------|---------|------------|------------|
| `netgraph:add-device` | `{x, y}` | canvas context menu | `modals/` |
| `netgraph:edit-device` | `{deviceId}` | sidebar / context menu | `modals/` |
| `netgraph:delete-device` | `{deviceId}` | sidebar / context menu | `modals/` |
| `netgraph:add-connection` | `{deviceId}` | context menu / sidebar | `modals/` |
| `netgraph:add-connected-device` | `{sourceId}` | device context menu | `modals/` |
| `netgraph:edit-connection` | `{linkId}` | connection context menu | `modals/` |
| `netgraph:delete-connection` | `{linkId}` | context menu / sidebar | `modals/` |
| `netgraph:connection-context-menu` | `{linkId, x, y}` | renderer | `main.ts` |
| `netgraph:new-map` | - | toolbar | `modals/` |
| `netgraph:manage-icons` | - | toolbar | `main.ts` |
| `netgraph:export-bundle` | - | toolbar | `modals/` (opens filename dialog) |
| `netgraph:export-bundle-confirmed` | `{filename}` | export-filename modal | `toolbar.ts` |

When adding a new UI action, prefer dispatching a `netgraph:*` event over importing the handler module directly.

## Conventions

- **Always use `rgb()` / `rgba()` for colors.** Never hex literals.
- **Always `escapeHtml(...)` user-controlled strings before `innerHTML` interpolation.** Search for the helper in `util.ts`.
- **Use `q<T>(root, sel)` from `util.ts` for typed queries inside modals/components.** Throws on miss, drops `as T` boilerplate.
- **Generate IDs via `generateId()` from `util.ts`.** Wraps `crypto.randomUUID()` so we can swap impls later.
- **Don't bind document/window-level listeners inside render loops.** Re-bind only the per-element listeners that genuinely change.

## Visual language

- Dark UI, high contrast, monospace font (`'SF Mono', 'Fira Code', 'Cascadia Code'`)
- Line grid background on the canvas, scales with zoom
- Orthogonal right-angle connection routing with rounded corners
- Hover feedback on cards is a border-color tint only - no lift/transform (a transform animation inside the CSS-scaled `#canvas-transform` re-rasterized siblings and blurred their text on non-Retina displays). The selected card gets a colored glow (`box-shadow`) plus a full-color border.
- Color palette and stacking-order constants live in `src/styles/_variables.scss`. Mirror them in `src/ts/util.ts` only for z-index values that TS needs to read.

## Layout zones

- **Top left** - brand wordmark
- **Top center** (only in connect mode) - `#connect-indicator` pill: live status text + Hub/Single/Advanced sub-mode pills
- **Top right** - map selector dropdown (also hosts New Map / Import / Export / Manage Icons / Download Offline Copy)
- **Bottom left** - help `?` button + slide-in `#help-panel`
- **Bottom right** - `#bottom-bar`: connect-mode toggle (own pill) + zoom bar (`−` · `100% / Fit` · `+`). The percentage button swaps to "Fit" on hover; clicking it fits content.
- **Right edge** (slide-in) - device detail panel, opens on device select
- Primary canvas actions are right-click / long-press only - no floating action buttons.

## Connect mode

Three sub-modes selected from the `#connect-indicator` pill, default `Hub`, sticky in-session, reset to `Hub` on reload. All share the same gesture: tap a device to anchor, optionally tap a handle to pre-pick a source side, tap a target to commit. Tap the anchor to cancel, empty-canvas tap to step back, Esc/toolbar button to exit.

- **Hub** - anchor stays on the source after each commit. One-to-many wiring.
- **Single** - anchor resets to idle after each commit. One link at a time.
- **Advanced** - same as Single, but `netgraph:edit-connection` is dispatched immediately after the commit so the editor opens for the new link.

Visuals: white inset glow on `#canvas` (`box-shadow: inset` strokes in `_connect-mode.scss`), non-anchor opacity softening is disabled in connect mode, a ghost preview line (`.conn-ghost`) follows the cursor and snaps to a hovered device's center. The ghost flips to amber (`.conn-ghost-duplicate`) when the hover target is already connected to the anchor - and the commit is silently rejected (`linkExists` in `util.ts` checks both directions in the links list; the device editor's auto-host-link path uses the same helper to dedupe). Hover Edit/Delete buttons on connections (`.conn-actions` foreignObject inside `.conn-group`) only appear in connect mode.

## Select mode

Multi-selection on the canvas with copy / paste / duplicate. Toggled by the `#select-toggle` pill in the bottom-right (left of the connect pill, marked with a dashed-rectangle marquee icon). Mutually exclusive with connect mode - turning either on turns the other off (via the `netgraph:enter-connect-mode` event and the exported `exitSelectMode` / `exitConnectMode` functions). Sticky in-session, off on reload.

The selection set is `selectedDeviceIds: Set<string>` in `state.ts`, separate from `selectedDeviceId` (which stays for the single-select / detail-panel path). Entering select mode closes the panel and clears single-select; exiting clears multi-select. The render pipeline threads both: `renderAll(map, selectedId, selectedIds)` -> `renderDevices` toggles `.selected` (single, type-tinted glow) and `.multi-selected` (cyan glow) per card. After-render hook in `select-mode.ts` prunes any selected ids whose devices vanished (map switch, external delete) so stale ids don't accumulate.

State machine: `off -> idle ↔ lassoing`. The `lassoing` substate is entered once the canvas pointermove has moved more than 2 px from pointerdown; the rect is drawn as an SVG `<rect class="select-lasso">` inside `#connections` (canvas-transform coords; `vector-effect: non-scaling-stroke` keeps the dash readable at any zoom).

**Lasso selection is live**, not on-release. Every `pointermove` during a lasso recomputes the hit set (`applyLassoSelection`: viewport-space, devices whose `getBoundingClientRect` center sits inside the rect) and calls `setSelectedDeviceIds`. A membership-equality guard skips the call when the set hasn't changed, so sub-pixel cursor jitter doesn't churn renders. Render coalescing (`scheduleRender`) keeps the actual `renderAll` to one-per-frame regardless of pointer cadence.

Click semantics in select mode:

- **Click a device** -> toggle in/out of selection (no Shift needed; the mode is dedicated).
- **Click empty canvas** (not a drag) -> clear the selection.
- **Drag empty canvas** -> lasso (replaces current selection live).
- **Drag a selected device** -> group drag: every selected device moves by the same dx/dy, snap-to-grid per device.
- **Right-click a selected device** -> multi-action menu (Copy · Duplicate · Delete) with a count badge per item.
- **Right-click a non-selected device** (even in select mode) -> per-device menu (Edit / Add Device / Add Connection / Delete). Escape hatch for "edit this one without disturbing the selection."
- **Right-click empty canvas** -> Paste (if clipboard) · Select All · Clear Selection.

**Group drag** lives in the device drag handler (`renderer/devices.ts attachDeviceDragHandlers`). At `pointerdown`, `beginGroupDrag(deviceId)` returns a `GroupDragSnapshot` (a `Map` of every selected device's origin position) when the dragged device is in a 2+-device selection, or `null` for a single drag. On `pointermove`, `applyGroupDrag(snapshot, dx, dy)` replays the canvas-space delta onto every member; on `pointerup`, `endGroupDrag` persists. Single-drag path is unchanged.

**Pan suppression** in select mode lives in `zoom.ts`: the gate sits in `pointermove`, between the pinch branch (`activePointers.size >= 2`) and the pan branch - so two-finger pinch still works on touch. The gate is *not* in pointerdown, because we still want pan state set up consistently so the first post-exit pan doesn't jump from a stale anchor.

### Clipboard

`src/ts/ui/clipboard.ts` is the pure copy/paste module (no DOM, deps injected). The in-memory clipboard lives in `select-mode.ts` module scope - not `localStorage`, so cross-session paste isn't supported (deliberate; keeps the rules simple).

- **`buildClipboard(map, selectedIds)`** -> `{ devices, links, centerX, centerY }` or `null`. Intra-selection links only (both endpoints in the selection); half-attached links dropped.
- **`pasteClipboard(clipboard, anchorX, anchorY, generateId, snapToGrid)`** -> `{ devices, links, newIds }`. Fresh ids for every device; link `sourceId`/`targetId` remapped through the id map; `hostId` remapped when the host is in the selection, dropped otherwise. Centroid lands at `(anchorX, anchorY)`; relative positions preserved; each device snapped to grid. `tags` array is defensively copied so the paste can't mutate the source.

Action wiring is via document events so the context menus stay decoupled from `select-mode.ts`:

| Event | Payload | Fired from | Handled in |
|-------|---------|------------|------------|
| `netgraph:copy-selection` | - | device ctx menu | `select-mode.ts` |
| `netgraph:duplicate-selection` | - | device ctx menu | `select-mode.ts` |
| `netgraph:delete-selection` | - | device ctx menu | `select-mode.ts` |
| `netgraph:paste` | `{x, y}` (viewport) | canvas ctx menu | `select-mode.ts` |
| `netgraph:select-all` | - | canvas ctx menu | `select-mode.ts` |
| `netgraph:clear-selection` | - | canvas ctx menu | `select-mode.ts` |
| `netgraph:enter-connect-mode` | - | connect-mode toggle | `select-mode.ts` (exits) |

**Paste is available outside select mode too** - the canvas context menu shows Paste whenever `hasClipboard()` is true, so a copy-then-exit-mode-then-paste-back flow works. Add Device is hidden in select mode (the mode owns the empty-canvas surface).

**Duplicate** = copy + paste in one step, offset by `(+48, +48)` from the source centroid instead of cursor-anchored - it's an in-place action.

**Delete Selection** removes every selected device, every link touching one of them (incl. links into the non-selected set, which would otherwise dangle), and clears `hostId` on surviving devices that pointed into the deleted set.

## Multi-map support

The active map id lives on `AppState.activeMapId`. `getActiveMap(state)` is the helper used everywhere - never index into `state.maps` directly. Custom icons are *global* (shared across maps) and stored on `AppState.customIcons`.

## First-run experience

`storage.ts createDefaultState` seeds a new install with `createExampleMap()` from `example-map.ts` - a curated home network that exercises every device type and shape (sparse vs fully-populated, VM-on-host, wide card, wireless link). The New Map dialog can also seed the example, but the checkbox is **off by default** (opt-in) since first-run already gives you one. The example references a custom icon (`example-rpi`); both seed paths route through `withExampleIcons()` so the icon is present even for a library that predates it - otherwise the home-server card renders the missing-icon glyph.

## Git workflow

- `main` - stable releases
- `develop` - active development; branch off here and PR back in (or PR to `main` for an urgent fix)

There are only these two long-lived branches; feature work happens on its own branch and merges back via PR.

Commits are GPG-signed and the upstream remote is pushed over SSH.

## Known caveats

- The mutate-then-`setState` pattern means quota errors can't truly roll back - the user sees an alert explaining the situation. Accepted design decision.
- The renderer's bend-position fallback (midpoint of centers) is dead code; `route.ts` short-circuits face-away cases to a U-shape before the renderer's bendAt is consulted. Left in place because it's harmless and documents the original intent.