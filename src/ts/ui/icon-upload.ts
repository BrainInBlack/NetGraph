import { sanitizeSvg, MAX_SVG_LENGTH } from '../svg-sanitizer';
import { generateId } from '../util';
import type { CustomIcon } from '../types';

// Shared by the icon picker (Custom tab) and the standalone Manage Icons
// modal so both upload flows enforce the same caps and produce identical
// stored icons.
//
// Uploads are SVG-only. Raster (`kind: 'image'`) icons are still accepted from
// imports and localStorage (see parse-shapes) so older maps keep their icons,
// but new ones can't be created: decoding a raster upload needs a blob: URL,
// which the page's Content Security Policy doesn't allow.

export { MAX_SVG_LENGTH };

export async function readFileAsIcon(file: File): Promise<CustomIcon> {
  // Accept the MIME type or the extension - some browsers / OS combos strip
  // MIME on drag-drop, so the extension check is the friendlier net.
  const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
  if (!isSvg) {
    throw new Error('Unsupported file type. Use an SVG file.');
  }

  if (file.size > MAX_SVG_LENGTH) {
    throw new Error(`SVG is too large (${Math.round(file.size / 1024)} KB). Maximum is ${MAX_SVG_LENGTH / 1024} KB.`);
  }

  // Strip the extension for the display name. Dotfiles ("foo.bar.svg" -> "foo.bar"
  // is fine; ".hidden" -> "" needs the fallback) collapse to an empty string
  // which the icon library doesn't render usefully - fall back to a generic.
  const name = file.name.replace(/\.[^.]+$/, '') || 'untitled';

  const text = await file.text();
  const cleaned = sanitizeSvg(text);
  if (!cleaned) throw new Error('Could not parse SVG file.');
  return { id: generateId(), name, kind: 'svg', data: cleaned, createdAt: new Date().toISOString() };
}
