/**
 * Allow-list-based SVG sanitizer for user-supplied or imported icon markup.
 *
 * Blocks everything that isn't on the explicit tag/attribute lists, including:
 *   - <script>                  - code execution
 *   - <foreignObject>           - arbitrary XHTML / JS via namespace tricks
 *   - <style>                   - CSS with external url() refs
 *   - <image>                   - phones home with the user's IP
 *   - <use href="http://...">   - external resource fetch
 *   - on* event handler attrs
 *   - href / xlink:href anywhere except <use>, and only fragment refs there
 *   - url(http://...) / url(data:...) in fill, stroke, style, filter, etc.
 *   - CDATA sections / comments - they survive XML serialization intact and
 *     can smuggle live markup across the XML->HTML re-parse boundary (mXSS)
 *
 * Walk is iterative so a pathologically nested SVG can't blow the stack.
 *
 * Note the parser asymmetry this defends against: we parse as `image/svg+xml`
 * (XML) but the app reinserts the result via `innerHTML` (HTML). A node that's
 * inert text in XML - e.g. a CDATA section holding `</title><img onerror=...>` -
 * serializes back out as `<![CDATA[...]]>` and, when HTML-parsed, can break out
 * into a live element. Stripping every non-element / non-text node closes that.
 */

/**
 * Hard cap on SVG source length. An icon glyph is tiny (Lucide icons are well
 * under 1 KB); 64 KB is generous headroom for an elaborate multi-path icon
 * while bounding parse/serialize cost and localStorage footprint. Oversized
 * input is rejected outright (`null`). This is the single size chokepoint -
 * both the import path (`parse-shapes`) and the upload path (`icon-picker`)
 * flow through `sanitizeSvg`, so the limit holds everywhere. Raster uploads
 * have their own separate, larger pre-downscale cap in `icon-picker`.
 */
export const MAX_SVG_LENGTH = 64 * 1024;

export function sanitizeSvg(text: string): string | null {
  if (text.length > MAX_SVG_LENGTH) return null;

  // A static analyzer may flag this parse as DOM-based XSS ("DOM text
  // reinterpreted as HTML"). It is a false positive: this is the sanitizer's own
  // entry point. The untrusted string is parsed here, then the tree is scrubbed
  // against an allow-list of tags and attributes and walked over all child nodes
  // (dropping CDATA, comments, and processing instructions, see the mXSS note
  // below) before `root.outerHTML` is returned. Nothing reaches the DOM
  // unsanitized.
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.querySelector('svg');
  if (!root || doc.querySelector('parsererror')) return null;

  // SVG is XML - names are case-sensitive. Allow-list lookups use the original
  // case; lowercasing here used to silently drop linearGradient, viewBox, etc.
  // Security checks (on*, href, url) stay case-insensitive - see isAttrAllowed.
  const stack: Element[] = [root];
  while (stack.length) {
    const el = stack.pop()!;

    for (const attr of [...el.attributes]) {
      if (!isAttrAllowed(el.tagName, attr.name, attr.value)) {
        el.removeAttribute(attr.name);
      }
    }

    // Walk *all* child nodes, not just elements. CDATA sections and comments
    // are never inspected by an element/attribute walk, yet they round-trip
    // through `outerHTML` and become an mXSS channel on HTML re-parse. Keep
    // allow-listed elements and plain text (serialization escapes text); drop
    // everything else (CDATA sections, comments, processing instructions).
    for (const child of [...el.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const elChild = child as Element;
        if (ALLOWED_TAGS.has(elChild.tagName)) stack.push(elChild);
        else elChild.remove();
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove();
      }
    }
  }

  return root.outerHTML;
}

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'title', 'desc',
  'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect',
  'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop',
  'use', 'symbol',
  'clipPath', 'mask',
]);

const SAFE_ATTRS_GLOBAL = new Set([
  'id', 'class', 'style',
  'transform', 'opacity',
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'clip-path', 'clip-rule', 'mask',
  'color',
  'viewBox', 'preserveAspectRatio',
  'x', 'y', 'width', 'height',
  // SVG namespace declarations are needed when DOMParser re-emits outerHTML
  'xmlns', 'xmlns:xlink', 'version',
]);

const SAFE_ATTRS_PER_TAG: Record<string, Set<string>> = {
  path:           new Set(['d', 'pathLength']),
  circle:         new Set(['cx', 'cy', 'r']),
  ellipse:        new Set(['cx', 'cy', 'rx', 'ry']),
  line:           new Set(['x1', 'y1', 'x2', 'y2']),
  polyline:       new Set(['points']),
  polygon:        new Set(['points']),
  rect:           new Set(['rx', 'ry']),
  text:           new Set(['dx', 'dy', 'text-anchor', 'dominant-baseline', 'font-family', 'font-size', 'font-weight']),
  tspan:          new Set(['dx', 'dy', 'text-anchor', 'dominant-baseline', 'font-family', 'font-size', 'font-weight']),
  linearGradient: new Set(['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod']),
  radialGradient: new Set(['cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform', 'spreadMethod']),
  stop:           new Set(['offset', 'stop-color', 'stop-opacity']),
  use:            new Set(['href', 'xlink:href']),
  symbol:         new Set(['viewBox']),
  clipPath:       new Set(['clipPathUnits']),
  mask:           new Set(['maskUnits', 'maskContentUnits']),
};

/**
 * Attributes whose values may contain `url(...)` references. Every url() token
 * inside them must resolve to a same-document fragment (`#some-id`); anything
 * pointing off-document is dropped.
 */
const URL_BEARING_ATTRS = new Set([
  'fill', 'stroke', 'color',
  'clip-path', 'mask', 'filter',
  'style',
]);

function isAttrAllowed(tag: string, name: string, value: string): boolean {
  const lname = name.toLowerCase();

  // Security checks stay case-insensitive - never trust `OnClick`, `HREF`, etc.
  if (lname.startsWith('on')) return false;

  if (lname === 'href' || lname === 'xlink:href') {
    if (tag !== 'use') return false;
    return /^#[a-zA-Z0-9_\-:.]+$/.test(value.trim());
  }

  if (URL_BEARING_ATTRS.has(lname) && !areAllUrlsFragmentRefs(value)) {
    return false;
  }

  if (SAFE_ATTRS_GLOBAL.has(name)) return true;
  if (SAFE_ATTRS_PER_TAG[tag]?.has(name)) return true;
  return false;
}

function areAllUrlsFragmentRefs(value: string): boolean {
  // A naive `url(` scan is bypassable two ways, both pointless in a real icon:
  //   1. CSS escapes - `\75rl(...)` is `url(...)` to the CSS parser but not to a
  //      literal-token regex. Any backslash in a paint/style value is suspect.
  //   2. Bare-string resource functions - image-set(), image(), cross-fade(),
  //      element() load external refs with no `url(` token at all.
  // Reject either outright before checking the remaining url() tokens.
  if (/\\/.test(value)) return false;
  if (/(?:image-set|image|cross-fade|element)\s*\(/i.test(value)) return false;

  const URL_TOKEN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = URL_TOKEN.exec(value)) !== null) {
    const target = match[2].trim();
    if (!target.startsWith('#')) return false;
  }
  return true;
}
