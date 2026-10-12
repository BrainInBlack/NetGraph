import { describe, it, expect } from 'vitest';
import { readFileAsIcon, MAX_SVG_LENGTH } from './icon-upload';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

describe('readFileAsIcon', () => {
  it('turns an SVG file into a sanitized svg icon named after the file', async () => {
    const icon = await readFileAsIcon(new File([SVG], 'switch.svg', { type: 'image/svg+xml' }));
    expect(icon.kind).toBe('svg');
    expect(icon.name).toBe('switch');
    expect(icon.data).toMatch(/^<svg[\s\S]*<path/);
  });

  it('accepts an .svg file whose MIME type was stripped', async () => {
    const icon = await readFileAsIcon(new File([SVG], 'nas.SVG', { type: '' }));
    expect(icon.kind).toBe('svg');
  });

  it.each([
    ['PNG', 'icon.png', 'image/png'],
    ['JPG', 'icon.jpg', 'image/jpeg'],
    ['JPEG', 'icon.jpeg', 'image/jpeg'],
  ])('rejects a %s upload (uploads are SVG-only)', async (_label, name, type) => {
    await expect(readFileAsIcon(new File([new Uint8Array([1, 2, 3])], name, { type })))
      .rejects.toThrow(/Use an SVG file/);
  });

  it('rejects an SVG over the size cap', async () => {
    const big = SVG.replace('</svg>', `<!--${'x'.repeat(MAX_SVG_LENGTH)}--></svg>`);
    await expect(readFileAsIcon(new File([big], 'big.svg', { type: 'image/svg+xml' })))
      .rejects.toThrow(/too large/);
  });

  it('rejects an SVG that does not parse', async () => {
    await expect(readFileAsIcon(new File(['<svg><unclosed'], 'bad.svg', { type: 'image/svg+xml' })))
      .rejects.toThrow(/Could not parse/);
  });
});
