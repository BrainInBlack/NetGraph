# NetGraph

Map your home or lab network in the browser - add your devices, draw how they're wired, label the bits that matter - and keep it all **local**: no backend, no accounts, no telemetry.

![License: PolyForm NC 1.0.0](https://img.shields.io/badge/license-PolyForm%20NC%201.0.0-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white) ![Vite](https://img.shields.io/badge/built%20with-Vite-646cff?logo=vite&logoColor=white) ![Local-first](https://img.shields.io/badge/data-100%25%20local-brightgreen) ![Offline](https://img.shields.io/badge/offline-single--file%20copy-informational) [![CI](https://github.com/BrainInBlack/NetGraph/actions/workflows/ci.yml/badge.svg)](https://github.com/BrainInBlack/NetGraph/actions/workflows/ci.yml)

## Why

You want a picture of your home or lab network - what's plugged into what, which port, which VLAN - without standing up a server, making an account, or trusting a SaaS with your topology. NetGraph is a single-page app that runs entirely in your browser: you draw the map by hand, it routes the cables for you, and everything is saved to `localStorage` on your machine. Nothing is transmitted, ever. When you want it portable, one menu click bakes the whole app into a single self-contained HTML file you can run from a USB stick or an air-gapped box.

## Features

- **Every device type** - modems, gateways, switches, access points, servers, VMs, and client machines, each with its own icon.
- **Self-routing connections** - clean orthogonal right-angle paths that bend around other cards and snap straight when devices line up. Wired or wireless, with optional labels for port numbers, VLAN tags, or link speeds.
- **Connect mode** - wire up fast: **Hub** fan-out from one device, **Single** one-link-at-a-time, or **Advanced** (the editor opens after each link). A live preview line follows the cursor and turns amber to block duplicates.
- **Multi-select** - lasso a group, then copy, paste, duplicate, or delete it; drag any member to move the whole set together.
- **VMs & containers** - mark a device as hosted on a parent, so the nesting is explicit.
- **Custom icons** - the built-in [Lucide](https://lucide.dev/) set or your own SVG / PNG / JPG uploads, shared across every map.
- **Multiple maps** - keep home, the lab, and a friend's network side by side and switch in a click.
- **Import / export** - plain JSON, for backups and sharing.
- **Offline copy** - the *Download Offline Copy* menu saves the entire app as one standalone HTML file.
- **Local-first by design** - no backend, no accounts, no telemetry; your data never leaves the browser.

## Browser support

Any modern desktop browser (Chrome, Firefox, Safari, Edge). Tablets are supported - drag to pan, pinch to zoom, long-press for context menus. Phones aren't a target: the panels and dialogs assume a tablet-or-larger screen.

## Get it

### Online

Open the hosted build at **[netgraph.khemul.de](https://netgraph.khemul.de)** in any modern browser. First run drops you on an example home network to poke around.

### Offline copy

Already running NetGraph? Open the top-right menu -> **Download Offline Copy**. It saves the whole app - JS, CSS, and icons inlined - as a single `netgraph.html`. Double-click it from your file manager or run it off a USB stick; it works online or fully air-gapped, and its data stays local to whatever browser opens it.

## Usage

1. **Add a device.** Right-click the empty canvas (long-press on a tablet) -> *Add Device*. Name and type are all you need; IP, MAC, domain, tags, and notes are optional.
2. **Connect two devices.** Right-click a device -> *Add Connection* -> pick the target. For wiring lots of links at once, use **connect mode** (button bottom-right, left of the zoom bar) and pick a sub-mode in the top-center pill.
3. **Label a connection.** Right-click a line -> *Edit* to set its type (wired/wireless), a label, and the port at each end - a jack number or a named port like WAN, LAN, or PoE. Labels reveal on hover.
4. **Select a group.** The lasso button (bottom-right) enters *select mode*: box-select on empty canvas or tap devices to toggle, then *Copy* / *Duplicate* / *Delete* from the right-click menu. *Paste* anchors at the cursor.
5. **Move around.** Drag devices anywhere, pan by dragging empty space, zoom with the wheel / pinch / zoom bar. Click the percentage to fit everything in view.
6. **Manage maps & icons.** The top-right menu holds *New Map*, the map switcher, *Manage Icons*, *Import*, *Export*, and *Download Offline Copy*.

Your map saves automatically as you go. The *?* button (bottom-left) opens a one-page quick reference.

## Your data

NetGraph keeps everything in your browser's local storage, on this device. There's no server and no account - which is the point - but it also means:

- Your maps are tied to **this browser**. Clearing site data, or opening NetGraph elsewhere, won't carry them over.
- **Export is your backup.** Use *Export* before big changes, and to move a map to another machine.
- The offline copy is a full standalone snapshot - handy for a USB stick or an air-gapped machine.

## Security

NetGraph ingests untrusted data in exactly two places - imported JSON bundles and uploaded custom icons (including SVG). Both go through a single validation layer (`parse-shapes.ts`) and an allow-list SVG sanitizer hardened against mutation-XSS; nothing user-supplied reaches the DOM unsanitized. Found a hole? See the [security policy](.github/SECURITY.md) for private reporting - please don't open a public issue.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) (c) BrainInBlack - free for noncommercial use.

Want to build NetGraph yourself or contribute? See [CONTRIBUTING.md](.github/CONTRIBUTING.md).
