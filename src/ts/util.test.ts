import { describe, it, expect } from 'vitest';
import { escapeHtml, snapToGrid } from './util';

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('escapes the ampersand first so other escapes are not double-encoded', () => {
    expect(escapeHtml('<')).toBe('&lt;');        // not &amp;lt;
    expect(escapeHtml('&lt;')).toBe('&amp;lt;'); // literal text round-trips safely
  });

  it('neutralizes a script-tag payload', () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('router.home 192.168.1.1')).toBe('router.home 192.168.1.1');
    expect(escapeHtml('')).toBe('');
  });
});

describe('snapToGrid', () => {
  it('snaps to the nearest 24-px multiple', () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(24)).toBe(24);
    expect(snapToGrid(11)).toBe(0);
    expect(snapToGrid(12)).toBe(24);
    expect(snapToGrid(35)).toBe(24);
    expect(snapToGrid(36)).toBe(48);
  });

  it('snaps negative values toward the nearest multiple', () => {
    expect(snapToGrid(-24)).toBe(-24);
    expect(snapToGrid(-36)).toBe(-24);
    expect(snapToGrid(-48)).toBe(-48);
  });
});
