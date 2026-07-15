# Contributing to NetGraph

NetGraph is a vanilla-TypeScript single-page app - no framework. It's built with
[Vite](https://vitejs.dev/), styled with SCSS, and stores everything in the
browser's `localStorage`; there's no backend. State lives in module-scope
variables and the DOM is the renderer.

This file covers building and developing NetGraph. For end-user instructions,
see [README.md](../README.md). For the full architecture and conventions, see
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or newer (current LTS).

Node is only needed to **build or develop** NetGraph - not to run a built copy.
The output is plain static files (and a single self-contained HTML file) that
run in any modern browser.

## Setup

```sh
npm install
```

`lucide-static` and `sass` are required peer dependencies; both are pinned in
`package.json`.

## Development

```sh
npm run dev        # Vite dev server at http://localhost:5173 with hot reload
```

> If you commit a change that deletes or renames a module, restart `npm run dev`
> - Vite's HMR can't always reconcile a moved module graph and the page may go
> blank until a fresh start. It's not a code bug; `tsc` and the tests stay green.

## Building

```sh
npm run build        # type-check, then build BOTH outputs
npm run build:web    # multi-file build only      -> dist/
npm run build:single # single-file build only     -> dist/download/netgraph.html
npm run preview      # serve the production build locally
```

There are two build outputs:

- A **multi-file build** for hosting on a webserver (split JS/CSS for caching).
- A **single self-contained `netgraph.html`** with JS, CSS, and the favicon all
  inlined - one file to move around, run from disk, or put on a USB stick.

```
dist/
├-- index.html            <- multi-file build (serve this from a webserver)
├-- assets/               <- JS, CSS, favicon
└-- download/
    └-- netgraph.html      <- single-file standalone build
```

## Tests & quality bar

```sh
npm test           # vitest, single pass
npm run test:watch # vitest in watch mode
npx tsc --noEmit   # type-check
```

The bar for any change is a **clean `npx tsc --noEmit`** and **passing
`npm test`**. There's no separate linter - `tsconfig.json` runs with `strict`,
`noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch`, so the
compiler is the linter.

Tests run on vitest with the happy-dom environment; test files are
`src/**/*.test.ts`. Coverage focuses on the pure / pure-ish modules
(`parse-shapes`, `svg-sanitizer`, `path-geometry`, `collision`, `route`,
`import-export`, `storage`, `graph/layout`, and the `util` helpers). DOM- and
pointer-heavy code (renderer, zoom, connect-mode, UI) is verified by hand rather
than unit-tested.

## Project layout

Single entry point at `src/ts/main.ts`. The detailed map - state flow, the
render pipeline, connection routing, and the data-validation / SVG-sanitizer
security model - lives in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md). Start there before changing
routing, persistence, or anything that ingests untrusted data (imports, custom
icons).

## Branches & pull requests

The repo has two long-lived branches:

- `main` - stable releases
- `develop` - active development

Create your own branch for your work, then open a pull request into `develop`
(or `main` for an urgent fix). Before you open it:

- `npx tsc --noEmit` is clean and `npm test` passes,
- `npm run build` succeeds (both the multi-file and single-file outputs),
- you've added a note under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md).

The [pull request template](PULL_REQUEST_TEMPLATE.md) has the full checklist.

## License

By contributing you agree your contributions are licensed under
[MIT + Commons Clause](../LICENSE).
