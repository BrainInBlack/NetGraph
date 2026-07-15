# Changelog

All notable changes to NetGraph are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Relicensed from PolyForm Noncommercial 1.0.0 to MIT + Commons Clause.**
  PolyForm NC barred all commercial use, including a company running NetGraph on
  its own internal network. The new terms allow use (companies included),
  modification, and free redistribution, and forbid only selling the software
  (per the Commons Clause). Updated `LICENSE`, `package.json`, the README badge
  and license note, and CONTRIBUTING.

## [1.3.0] - 2026-06-25

First public release. NetGraph had been developed privately up to this point;
this is the initial open-sourcing of the code at version 1.3.0. Everything below
describes the app as it stands at that release.

### Added

- **Network mapping** - place modems, gateways, switches, access points,
  servers, VMs, and client devices on a pannable, zoomable canvas, each with a
  name, type, IP, MAC, domain, tags, and notes.
- **Self-routing connections** - orthogonal right-angle paths with rounded
  corners that route around other device cards, fall back to U-shapes for
  awkward angles, and snap straight when cards line up. Wired or wireless, with
  optional labels and a port at each end (a jack number or a named port like
  WAN, LAN, or PoE). Multiple links to one device fan out so they don't overlap.
- **Connect mode** - fast wiring with three sub-modes: **Hub** (fan out from one
  device), **Single** (one link at a time), and **Advanced** (the editor opens
  after each link). A live preview line follows the cursor and turns amber to
  block duplicate connections.
- **Select mode** - lasso a group of devices (live selection as the box sweeps),
  drag the whole group together, and copy, paste, duplicate, or delete the
  selection.
- **VMs & containers** - mark a device as hosted on a parent so the nesting is
  explicit on the map.
- **Custom icons** - use the built-in Lucide set or upload your own SVG, PNG, or
  JPG; icons are shared across every map. Uploaded SVGs pass through an
  allow-list sanitizer.
- **Multiple maps** - keep separate maps (blank or seeded from a worked example)
  and switch between them, rename, or delete.
- **Import / export** - save and load maps as plain JSON for backup and sharing,
  with full validation of every imported record.
- **Offline copy** - *Download Offline Copy* bakes the entire app into a single
  self-contained HTML file that runs from disk or a USB stick, online or
  air-gapped.
- **Local-first storage** - everything lives in the browser's `localStorage`;
  no backend, no accounts, no telemetry. Data never leaves the machine.
- **Touch support** - drag to pan, pinch to zoom, and long-press for context
  menus on tablets.

[Unreleased]: https://github.com/BrainInBlack/NetGraph/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/BrainInBlack/NetGraph/releases/tag/v1.3.0
