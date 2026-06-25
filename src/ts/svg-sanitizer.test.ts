import { describe, it, expect } from 'vitest';
import { sanitizeSvg, MAX_SVG_LENGTH } from './svg-sanitizer';

const wrap = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`;

// ── Parse failures ──────────────────────────────────────────────

describe('sanitizeSvg — parse failures', () => {
  it('returns null for empty input', () => {
    expect(sanitizeSvg('')).toBeNull();
  });

  it('returns null for plain text with no XML', () => {
    expect(sanitizeSvg('hello world')).toBeNull();
  });

  it('returns null for non-SVG XML', () => {
    expect(sanitizeSvg('<foo><bar/></foo>')).toBeNull();
  });

  it('returns null for malformed XML', () => {
    expect(sanitizeSvg('<svg><path d="M0 0 L 1')).toBeNull();
  });
});

// ── Size cap ────────────────────────────────────────────────────

describe('sanitizeSvg — size cap', () => {
  it('rejects SVG source over MAX_SVG_LENGTH', () => {
    // Pad a valid SVG past the cap with a long (harmless) path data string.
    const pad = 'L0 0'.repeat(MAX_SVG_LENGTH); // far exceeds the limit
    const huge = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 ${pad}"/></svg>`;
    expect(huge.length).toBeGreaterThan(MAX_SVG_LENGTH);
    expect(sanitizeSvg(huge)).toBeNull();
  });

  it('accepts SVG comfortably under the cap', () => {
    const small = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
    expect(small.length).toBeLessThan(MAX_SVG_LENGTH);
    expect(sanitizeSvg(small)).not.toBeNull();
  });
});

// ── Tag allow-list ──────────────────────────────────────────────

describe('sanitizeSvg — tag stripping', () => {
  it('strips <script> tag and contents', () => {
    const out = sanitizeSvg(wrap('<script>alert(1)</script><circle cx="5" cy="5" r="3"/>'));
    expect(out).not.toBeNull();
    expect(out!).not.toMatch(/<script/i);
    expect(out!).toMatch(/<circle/);
  });

  it('strips <foreignObject>', () => {
    const out = sanitizeSvg(wrap('<foreignObject><div onclick="x"/></foreignObject>'));
    expect(out!).not.toMatch(/foreignObject/i);
    expect(out!).not.toMatch(/<div/i);
  });

  it('strips <style> (could carry url() refs)', () => {
    const out = sanitizeSvg(wrap('<style>@import url("http://evil")</style>'));
    expect(out!).not.toMatch(/<style/i);
    expect(out!).not.toMatch(/http:\/\/evil/);
  });

  it('strips <image> (would leak the viewer IP on load)', () => {
    const out = sanitizeSvg(wrap('<image href="http://tracker.example/pixel.png"/>'));
    expect(out!).not.toMatch(/<image/i);
    expect(out!).not.toMatch(/tracker\.example/);
  });

  it('strips <iframe>', () => {
    const out = sanitizeSvg(wrap('<iframe src="http://evil"/>'));
    expect(out!).not.toMatch(/<iframe/i);
  });

  it('strips disallowed tags nested several levels deep', () => {
    const out = sanitizeSvg(wrap('<g><g><g><script>x</script></g></g></g>'));
    expect(out!).not.toMatch(/<script/i);
    expect(out!).toMatch(/<g/);
  });

  it('preserves the standard shape tags', () => {
    const inner = '<path d="M0 0"/><circle cx="1" cy="1" r="1"/><ellipse cx="1" cy="1" rx="1" ry="1"/>'
      + '<line x1="0" y1="0" x2="1" y2="1"/><polyline points="0,0 1,1"/><polygon points="0,0 1,0 0,1"/>'
      + '<rect/>';
    const out = sanitizeSvg(wrap(inner));
    expect(out!).toMatch(/<path/);
    expect(out!).toMatch(/<circle/);
    expect(out!).toMatch(/<ellipse/);
    expect(out!).toMatch(/<line/);
    expect(out!).toMatch(/<polyline/);
    expect(out!).toMatch(/<polygon/);
    expect(out!).toMatch(/<rect/);
  });

  it('preserves gradient and clipPath/mask elements (case-sensitive)', () => {
    const inner = '<defs>'
      + '<linearGradient id="g1"><stop offset="0" stop-color="red"/></linearGradient>'
      + '<radialGradient id="g2"><stop offset="0" stop-color="blue"/></radialGradient>'
      + '<clipPath id="c1"><rect/></clipPath>'
      + '<mask id="m1"><rect/></mask>'
      + '<symbol id="s1" viewBox="0 0 1 1"><circle cx="0" cy="0" r="1"/></symbol>'
      + '</defs>'
      + '<use href="#s1"/>';
    const out = sanitizeSvg(wrap(inner));
    expect(out!).toMatch(/linearGradient/);
    expect(out!).toMatch(/radialGradient/);
    expect(out!).toMatch(/clipPath/);
    expect(out!).toMatch(/<mask/);
    expect(out!).toMatch(/<symbol/);
    expect(out!).toMatch(/<use[^>]+href="#s1"/);
  });
});

// ── Event handler attributes ────────────────────────────────────

describe('sanitizeSvg — event handlers', () => {
  it('strips onclick', () => {
    const out = sanitizeSvg(wrap('<circle cx="5" cy="5" r="3" onclick="alert(1)"/>'));
    expect(out!).not.toMatch(/onclick/i);
  });

  it('strips onload', () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`);
    expect(out!).not.toMatch(/onload/i);
  });

  it('strips arbitrary on* handlers (onerror, onmouseover, onfocus, …)', () => {
    const out = sanitizeSvg(wrap(
      '<circle cx="5" cy="5" r="3" onerror="x" onmouseover="x" onfocus="x" onsomething="x"/>'
    ));
    expect(out!).not.toMatch(/\bon[a-z]+\s*=/i);
  });
});

// ── href / xlink:href ───────────────────────────────────────────

describe('sanitizeSvg — href / xlink:href', () => {
  it('allows fragment-only href on <use>', () => {
    const out = sanitizeSvg(wrap('<symbol id="s1"><circle cx="0" cy="0" r="1"/></symbol><use href="#s1"/>'));
    expect(out!).toMatch(/<use[^>]+href="#s1"/);
  });

  it('strips http:// href on <use>', () => {
    const out = sanitizeSvg(wrap('<use href="http://evil/icon.svg"/>'));
    expect(out!).not.toMatch(/href="http/);
  });

  it('strips javascript: href on <use>', () => {
    const out = sanitizeSvg(wrap('<use href="javascript:alert(1)"/>'));
    expect(out!).not.toMatch(/href="javascript/i);
  });

  it('strips data: href on <use>', () => {
    const out = sanitizeSvg(wrap('<use href="data:image/svg+xml;base64,xxx"/>'));
    expect(out!).not.toMatch(/href="data:/i);
  });

  it('strips href entirely from non-<use> tags even when fragment-valid', () => {
    const out = sanitizeSvg(wrap('<circle cx="5" cy="5" r="3" href="#anchor"/>'));
    expect(out!).not.toMatch(/href=/);
  });

  it('rejects fragment hrefs that contain disallowed characters', () => {
    // The pattern allows [a-zA-Z0-9_\-:.] — a literal space or quote is rejected.
    const out = sanitizeSvg(wrap('<use href="#has space"/>'));
    expect(out!).not.toMatch(/href=/);
  });

  it('strips xlink:href pointing off-document on <use>', () => {
    const out = sanitizeSvg(wrap('<use xlink:href="http://evil"/>'));
    expect(out!).not.toMatch(/xlink:href="http/);
  });
});

// ── URL-bearing attributes ──────────────────────────────────────

describe('sanitizeSvg — url() values', () => {
  it('keeps fill="url(#frag)"', () => {
    const out = sanitizeSvg(wrap('<defs><linearGradient id="g"/></defs><rect fill="url(#g)"/>'));
    expect(out!).toMatch(/fill="url\(#g\)"/);
  });

  it('drops fill when it references http://', () => {
    const out = sanitizeSvg(wrap('<rect fill="url(http://evil/x.png)"/>'));
    expect(out!).not.toMatch(/fill=/);
  });

  it('drops fill when it references a data: url', () => {
    const out = sanitizeSvg(wrap('<rect fill="url(data:image/png;base64,abc)"/>'));
    expect(out!).not.toMatch(/fill=/);
  });

  it('drops style when it embeds an off-document url', () => {
    const out = sanitizeSvg(wrap('<rect style="fill: url(http://evil); stroke: red"/>'));
    expect(out!).not.toMatch(/style=/);
  });

  it('keeps style when every url() inside it is a fragment', () => {
    const out = sanitizeSvg(wrap(
      '<defs><linearGradient id="g"/><mask id="m"/></defs>'
      + '<rect style="fill: url(#g); mask: url(#m);"/>'
    ));
    expect(out!).toMatch(/style="[^"]*url\(#g\)[^"]*url\(#m\)/);
  });

  it('drops attribute when MIXED urls (one fragment, one off-doc) appear', () => {
    const out = sanitizeSvg(wrap('<rect style="fill: url(#ok); mask: url(http://evil)"/>'));
    expect(out!).not.toMatch(/style=/);
  });

  it('drops filter attribute pointing off-document', () => {
    const out = sanitizeSvg(wrap('<rect filter="url(http://evil)"/>'));
    expect(out!).not.toMatch(/filter=/);
  });

  it('drops filter even when it references a fragment (not on the allow-list)', () => {
    // `filter` appears in URL_BEARING_ATTRS so its url() values get validated,
    // but it isn't on the SAFE_ATTRS allow-list — so it's dropped either way.
    // User icons don't need filter support; only the renderer's own
    // connection-label halo uses filter, and that's applied in code.
    const out = sanitizeSvg(wrap('<defs/><rect filter="url(#blur)"/>'));
    expect(out!).not.toMatch(/filter=/);
  });

  it('keeps url-bearing attribute with no url() tokens at all', () => {
    const out = sanitizeSvg(wrap('<rect fill="red"/>'));
    expect(out!).toMatch(/fill="red"/);
  });
});

// ── Mutation-XSS via non-element nodes ──────────────────────────
//
// We parse as image/svg+xml (XML) but the app reinserts via innerHTML (HTML).
// CDATA sections and comments survive XML serialization intact and can smuggle
// markup that becomes live on HTML re-parse. The walk must strip them.

describe('sanitizeSvg — non-element nodes (mXSS channel)', () => {
  // The headline vector: </title> inside CDATA breaks out on HTML re-parse,
  // turning the trailing <img onerror> into a live element. NB: XML parsers
  // disagree on CDATA — Chromium (what the app runs in) parses it and our walk
  // strips the node; happy-dom rejects the whole input (null). Both are safe,
  // so we assert "null OR free of smuggled markup". The Chromium fix was
  // verified directly with a browser probe; the comment test below guards the
  // same node-stripping code path deterministically in this env.
  it('never lets a CDATA section inside <title> smuggle live markup', () => {
    const out = sanitizeSvg(wrap(
      `<title><![CDATA[</title><img src=http://sentinel.invalid/x onerror=alert(1)>]]></title>`
    ));
    if (out !== null) {
      expect(out).not.toMatch(/<!\[CDATA\[/);
      expect(out).not.toMatch(/<img/i);
      expect(out).not.toMatch(/onerror/i);
      expect(out).not.toMatch(/sentinel\.invalid/);
    }
  });

  it('never lets a bare CDATA section at the svg root smuggle markup', () => {
    const out = sanitizeSvg(wrap(`<![CDATA[<img src=http://evil onerror=alert(1)>]]>`));
    if (out !== null) {
      expect(out).not.toMatch(/<!\[CDATA\[/);
      expect(out).not.toMatch(/<img/i);
      expect(out).not.toMatch(/evil/);
    }
  });

  it('strips comments that carry markup', () => {
    const out = sanitizeSvg(wrap(`<!--<img src=http://evil onerror=alert(1)>--><circle r="1"/>`));
    expect(out!).not.toMatch(/<!--/);
    expect(out!).not.toMatch(/<img/i);
    expect(out!).toMatch(/<circle/);
  });

  it('keeps legitimate <title> / <desc> text content', () => {
    const out = sanitizeSvg(wrap('<title>My Router</title><desc>edge gateway</desc><circle r="5"/>'));
    expect(out!).toMatch(/<title>My Router<\/title>/);
    expect(out!).toMatch(/<desc>edge gateway<\/desc>/);
  });

  it('keeps entity-encoded markup as inert escaped text', () => {
    const out = sanitizeSvg(wrap('<text>&lt;img src=x&gt;</text>'));
    // Survives as escaped text, never as a real element
    expect(out!).toMatch(/&lt;img/);
    expect(out!).not.toMatch(/<img/i);
  });

  it('re-parsing the sanitized output as HTML yields no live <img>', () => {
    // Mirrors the app's reinsertion path exactly.
    const out = sanitizeSvg(wrap(
      `<title><![CDATA[</title><img src=http://sentinel.invalid/x onerror=alert(1)>]]></title>`
    ));
    const div = document.createElement('div');
    div.innerHTML = `<div class="device-icon">${out}</div>`;
    expect(div.querySelector('img')).toBeNull();
  });
});

// ── URL filter bypasses ─────────────────────────────────────────

describe('sanitizeSvg — url() filter bypasses', () => {
  it('drops style using a CSS-escaped url token (\\75rl)', () => {
    const out = sanitizeSvg(wrap('<rect style="fill:\\75rl(http://evil/x.png)"/>'));
    expect(out!).not.toMatch(/style=/);
    expect(out!).not.toMatch(/evil/);
  });

  it('drops the same CSS escape on a presentation attribute (fill)', () => {
    const out = sanitizeSvg(wrap('<rect fill="\\75rl(http://evil/x.png)"/>'));
    expect(out!).not.toMatch(/fill=/);
    expect(out!).not.toMatch(/evil/);
  });

  it('drops style using image-set() (loads a resource with no url() token)', () => {
    const out = sanitizeSvg(wrap(`<rect style="background-image:image-set('http://evil/x.png' 1x)"/>`));
    expect(out!).not.toMatch(/style=/);
    expect(out!).not.toMatch(/evil/);
  });

  it('still keeps a clean style with only fragment url() refs', () => {
    const out = sanitizeSvg(wrap(
      '<defs><linearGradient id="g"/></defs><rect style="fill:url(#g);opacity:0.5"/>'
    ));
    expect(out!).toMatch(/style="[^"]*url\(#g\)/);
  });
});

// ── Per-tag attribute allow-lists ───────────────────────────────

describe('sanitizeSvg — per-tag attributes', () => {
  it('keeps path-specific d and pathLength', () => {
    const out = sanitizeSvg(wrap('<path d="M0 0 L 10 10" pathLength="20"/>'));
    expect(out!).toMatch(/d="M0 0 L 10 10"/);
    expect(out!).toMatch(/pathLength="20"/);
  });

  it('strips attributes that belong to another tag', () => {
    const out = sanitizeSvg(wrap('<path cx="5" cy="5" r="3" d="M0 0"/>'));
    expect(out!).not.toMatch(/\bcx=/);
    expect(out!).not.toMatch(/\bcy=/);
    expect(out!).not.toMatch(/\br=/);
    expect(out!).toMatch(/d="M0 0"/);
  });

  it('strips unknown attributes from any tag', () => {
    const out = sanitizeSvg(wrap('<circle cx="5" cy="5" r="3" foo="bar" data-x="evil"/>'));
    expect(out!).not.toMatch(/foo=/);
    expect(out!).not.toMatch(/data-x=/);
    expect(out!).toMatch(/cx="5"/);
  });
});

// ── Global allowed attributes ───────────────────────────────────

describe('sanitizeSvg — global attributes', () => {
  it('keeps id, class, transform, opacity on any tag', () => {
    const out = sanitizeSvg(wrap(
      '<g id="root" class="layer" transform="translate(5,5)" opacity="0.5"/>'
    ));
    expect(out!).toMatch(/id="root"/);
    expect(out!).toMatch(/class="layer"/);
    expect(out!).toMatch(/transform="translate\(5,5\)"/);
    expect(out!).toMatch(/opacity="0\.5"/);
  });

  it('keeps stroke-* family attributes', () => {
    const out = sanitizeSvg(wrap(
      '<path d="M0 0" stroke="red" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 2"/>'
    ));
    expect(out!).toMatch(/stroke="red"/);
    expect(out!).toMatch(/stroke-width="2"/);
    expect(out!).toMatch(/stroke-linecap="round"/);
    expect(out!).toMatch(/stroke-dasharray="4 2"/);
  });

  it('keeps viewBox and preserveAspectRatio on root', () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" preserveAspectRatio="xMidYMid meet"/>'
    );
    expect(out!).toMatch(/viewBox="0 0 10 10"/);
    expect(out!).toMatch(/preserveAspectRatio="xMidYMid meet"/);
  });
});

// ── Integration ─────────────────────────────────────────────────

describe('sanitizeSvg — end-to-end', () => {
  it('returns a non-null string for a clean lucide-style icon', () => {
    const lucideStyle =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
      + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>';
    const out = sanitizeSvg(lucideStyle);
    expect(out).not.toBeNull();
    expect(out!).toMatch(/<svg/);
    expect(out!).toMatch(/M5 12h14/);
  });

  it('produces output free of every dangerous construct from a kitchen-sink attack', () => {
    const evil =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">'
      + '  <script>alert(2)</script>'
      + '  <foreignObject><iframe src="http://evil"/></foreignObject>'
      + '  <image href="http://tracker/p"/>'
      + '  <style>* { background: url(http://evil) }</style>'
      + '  <circle cx="5" cy="5" r="3" onclick="alert(3)" fill="url(http://evil)"/>'
      + '  <use href="javascript:alert(4)"/>'
      + '</svg>';
    const out = sanitizeSvg(evil);
    expect(out).not.toBeNull();
    expect(out!).not.toMatch(/<script/i);
    expect(out!).not.toMatch(/foreignObject/i);
    expect(out!).not.toMatch(/<iframe/i);
    expect(out!).not.toMatch(/<image/i);
    expect(out!).not.toMatch(/<style/i);
    expect(out!).not.toMatch(/\bon[a-z]+\s*=/i);
    expect(out!).not.toMatch(/http:\/\/evil/);
    expect(out!).not.toMatch(/http:\/\/tracker/);
    expect(out!).not.toMatch(/javascript:/i);
  });
});
