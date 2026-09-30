import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const { version: appVersion } = createRequire(import.meta.url)('./package.json') as { version: string };

/**
 * Inline the favicon as a base64 data URL so the final `dist/` is just one
 * `index.html` file. vite-plugin-singlefile inlines JS/CSS but ignores
 * `<link rel="icon">` references, so we rewrite the href in `generateBundle`
 * (runs after all plugins have finished transforming the HTML) and drop the
 * separate favicon asset from the bundle.
 */
function inlineFavicon() {
  return {
    name: 'inline-favicon',
    enforce: 'post' as const,
    generateBundle: {
      order: 'post' as const,
      handler(_opts: unknown, bundle: Record<string, { fileName: string; source?: string | Uint8Array; type?: string }>) {
        // Match Vite's hashed naming pattern exactly so a user-uploaded asset
        // that happens to contain "favicon" in its name can't be silently
        // swallowed. Vite emits `favicon-<hash>.svg` for our one source file.
        const FAVICON_FILE = /^favicon-[\w-]+\.svg$/;
        const favicon = Object.values(bundle).find(b => FAVICON_FILE.test(b.fileName));
        const html = Object.values(bundle).find(b => b.fileName === 'index.html');
        if (!favicon || favicon.source == null || !html || typeof html.source !== 'string') return;
        const svg = typeof favicon.source === 'string'
          ? favicon.source
          : Buffer.from(favicon.source).toString('utf-8');
        const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
        // Match the exact emitted filename in the href, not any "favicon" string
        const escapedName = favicon.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        html.source = html.source.replace(new RegExp(`href="[^"]*${escapedName}"`), `href="${dataUrl}"`);
        delete bundle[favicon.fileName];
      },
    },
  };
}

/**
 * Allow the single-file build's inlined script under the CSP in index.html.
 * vite-plugin-singlefile turns `<script src>` into an inline `<script>`, which
 * `script-src 'self'` blocks - so hash every inline script body and append the
 * `'sha256-...'` sources to script-src (keeps 'unsafe-inline' out of the
 * policy). Runs in the `post` generateBundle phase, after singlefile inlined
 * and minified the code, so the hash covers the exact shipped bytes. Fails the
 * build if the CSP marker is missing rather than shipping a page that won't run.
 */
function cspInlineScriptHashes() {
  return {
    name: 'csp-inline-script-hashes',
    enforce: 'post' as const,
    generateBundle: {
      order: 'post' as const,
      handler(_opts: unknown, bundle: Record<string, { fileName: string; source?: string | Uint8Array }>) {
        const html = Object.values(bundle).find(b => b.fileName === 'index.html');
        if (!html || typeof html.source !== 'string') return;
        const hashes = [...html.source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
          .map(m => m[1])
          .filter(body => body.length > 0)
          .map(body => `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
        // Anchored to the CSP meta's content attribute, so a mention of the
        // directive elsewhere (e.g. an HTML comment) can't take the hashes.
        const CSP_SCRIPT_SRC = /(http-equiv="Content-Security-Policy"\s+content="[^"]*?script-src 'self')/;
        if (!CSP_SCRIPT_SRC.test(html.source)) {
          throw new Error("csp-inline-script-hashes: no \"script-src 'self'\" in the index.html CSP meta");
        }
        html.source = html.source.replace(CSP_SCRIPT_SRC, `$1 ${hashes.join(' ')}`);
      },
    },
  };
}

/**
 * Rename the emitted HTML file on disk. Vite names the single-file output
 * `index.html` (after its `index.html` entry); we want it served as
 * `netgraph.html` so the download has a meaningful name. Done in `writeBundle`
 * with Node's `fs` - no shell `mv` (not portable), and Rolldown forbids
 * mutating the bundle map in `generateBundle`.
 */
function renameHtml(to: string) {
  return {
    name: 'rename-html',
    enforce: 'post' as const,
    writeBundle(opts: { dir?: string }) {
      if (!opts.dir) return;
      renameSync(join(opts.dir, 'index.html'), join(opts.dir, to));
    },
  };
}

/**
 * Two build modes:
 *
 *   vite build                -> dist/             (multi-file build for the webserver)
 *   vite build --mode single  -> dist/download/    (single self-contained netgraph.html)
 *
 * `npm run build` runs both.
 */
export default defineConfig(({ mode, command }) => {
  const single = mode === 'single';
  return {
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      // True only for the deployed multi-file web build - the one place
      // download/netgraph.html actually exists.
      __WEB_BUILD__: JSON.stringify(command === 'build' && !single),
    },
    plugins: single
      ? [viteSingleFile(), inlineFavicon(), cspInlineScriptHashes(), renameHtml('netgraph.html')]
      : [],
    build: {
      outDir: single ? 'dist/download' : 'dist',
      emptyOutDir: true,
      minify: single,
    },
  };
});
