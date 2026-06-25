import { describe, it, expect } from 'vitest';
import {
  parseMap,
  parseDevice,
  parseLink,
  parseCustomIcon,
  parseCustomIcons,
  isObject,
  MAX_DEVICES_PER_MAP,
  MAX_LINKS_PER_MAP,
  MAX_CUSTOM_ICONS,
} from './parse-shapes';
import { DEVICE_WIDTH_MIN, DEVICE_WIDTH_MAX, MAX_NOTES_LENGTH } from './device-config';

// ── isObject ─────────────────────────────────────────────────

describe('isObject', () => {
  it('accepts plain objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });
  it('rejects arrays, null, primitives', () => {
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject('string')).toBe(false);
    expect(isObject(42)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });
});

// ── parseDevice ──────────────────────────────────────────────

describe('parseDevice', () => {
  const minimal = { id: 'd1', name: 'router', type: 'gateway' };

  it('parses a minimal valid device', () => {
    const d = parseDevice(minimal);
    expect(d).not.toBeNull();
    expect(d!.id).toBe('d1');
    expect(d!.name).toBe('router');
    expect(d!.type).toBe('gateway');
    expect(d!.x).toBe(0);
    expect(d!.y).toBe(0);
    expect(d!.tags).toEqual([]);
    expect(d!.notes).toBe('');
  });

  it('returns null for non-object input', () => {
    expect(parseDevice(null)).toBeNull();
    expect(parseDevice('string')).toBeNull();
    expect(parseDevice([])).toBeNull();
    expect(parseDevice(42)).toBeNull();
  });

  it('returns null when id or name is missing or wrong type', () => {
    expect(parseDevice({ name: 'x', type: 'client' })).toBeNull();
    expect(parseDevice({ id: 'd1', type: 'client' })).toBeNull();
    expect(parseDevice({ id: 42, name: 'x', type: 'client' })).toBeNull();
    expect(parseDevice({ id: 'd1', name: 42, type: 'client' })).toBeNull();
  });

  it('rejects ids that escape the safe alphabet (attribute-injection guard)', () => {
    // crypto.randomUUID() style ids pass
    expect(parseDevice({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'x', type: 'client' })).not.toBeNull();
    expect(parseDevice({ id: 'custom:abc_1', name: 'x', type: 'client' })).not.toBeNull();
    // attribute-breakout payloads are rejected
    expect(parseDevice({ id: 'x" onmouseover="alert(1)', name: 'x', type: 'client' })).toBeNull();
    expect(parseDevice({ id: 'a b', name: 'x', type: 'client' })).toBeNull();
    expect(parseDevice({ id: '<img>', name: 'x', type: 'client' })).toBeNull();
    expect(parseDevice({ id: '', name: 'x', type: 'client' })).toBeNull();
    expect(parseDevice({ id: 'a'.repeat(129), name: 'x', type: 'client' })).toBeNull();
  });

  it('falls back to "client" for unknown device types', () => {
    expect(parseDevice({ ...minimal, type: 'mainframe' })!.type).toBe('client');
    expect(parseDevice({ ...minimal, type: undefined })!.type).toBe('client');
    expect(parseDevice({ ...minimal, type: 123 })!.type).toBe('client');
  });

  it('accepts every documented device type', () => {
    for (const t of ['modem', 'gateway', 'switch', 'ap', 'server', 'vm', 'client']) {
      expect(parseDevice({ ...minimal, type: t })!.type).toBe(t);
    }
  });

  it('truncates oversized name, ip, mac, domain, notes', () => {
    const d = parseDevice({
      ...minimal,
      name: 'x'.repeat(500),
      ip: 'y'.repeat(500),
      mac: 'z'.repeat(500),
      domain: 'w'.repeat(500),
      notes: 'n'.repeat(MAX_NOTES_LENGTH + 500),
    })!;
    expect(d.name.length).toBe(200);
    expect(d.ip!.length).toBe(100);
    expect(d.mac!.length).toBe(50);
    expect(d.domain!.length).toBe(200);
    expect(d.notes.length).toBe(MAX_NOTES_LENGTH);
  });

  it('drops empty/non-string optional fields', () => {
    const d = parseDevice({ ...minimal, ip: '', mac: 42, domain: null })!;
    expect(d.ip).toBeUndefined();
    expect(d.mac).toBeUndefined();
    expect(d.domain).toBeUndefined();
  });

  it('filters tags to strings only, truncates each, caps array', () => {
    const d = parseDevice({
      ...minimal,
      tags: ['ok', 42, null, 'a'.repeat(100), ...Array.from({ length: 100 }, (_, i) => `t${i}`)],
    })!;
    expect(d.tags.length).toBe(50);
    expect(d.tags[0]).toBe('ok');
    expect(d.tags[1]).toBe('a'.repeat(50));
    expect(d.tags.every(t => typeof t === 'string')).toBe(true);
  });

  it('returns empty tags for non-array', () => {
    expect(parseDevice({ ...minimal, tags: 'not-array' })!.tags).toEqual([]);
    expect(parseDevice({ ...minimal, tags: null })!.tags).toEqual([]);
  });

  it('keeps finite x/y, defaults non-finite to 0', () => {
    expect(parseDevice({ ...minimal, x: 100, y: -50 })!.x).toBe(100);
    expect(parseDevice({ ...minimal, x: 100, y: -50 })!.y).toBe(-50);
    expect(parseDevice({ ...minimal, x: Infinity })!.x).toBe(0);
    expect(parseDevice({ ...minimal, x: NaN })!.x).toBe(0);
    expect(parseDevice({ ...minimal, x: 'huh' })!.x).toBe(0);
  });

  it('accepts lucide: and custom: iconIds, rejects others', () => {
    expect(parseDevice({ ...minimal, iconId: 'lucide:router' })!.iconId).toBe('lucide:router');
    expect(parseDevice({ ...minimal, iconId: 'custom:abc' })!.iconId).toBe('custom:abc');
    expect(parseDevice({ ...minimal, iconId: 'evil:foo' })!.iconId).toBeUndefined();
    expect(parseDevice({ ...minimal, iconId: '' })!.iconId).toBeUndefined();
    expect(parseDevice({ ...minimal, iconId: 42 })!.iconId).toBeUndefined();
  });

  it('clamps width to [DEVICE_WIDTH_MIN, DEVICE_WIDTH_MAX], else undefined', () => {
    expect(parseDevice({ ...minimal, width: 300 })!.width).toBe(300);
    expect(parseDevice({ ...minimal, width: DEVICE_WIDTH_MIN - 1 })!.width).toBeUndefined();
    expect(parseDevice({ ...minimal, width: DEVICE_WIDTH_MAX + 1 })!.width).toBeUndefined();
    expect(parseDevice({ ...minimal, width: 'huh' })!.width).toBeUndefined();
    expect(parseDevice({ ...minimal, width: Infinity })!.width).toBeUndefined();
  });

  it('keeps a valid port number; drops invalid', () => {
    expect(parseDevice({ ...minimal, port: 8080 })!.port).toBe(8080);
    expect(parseDevice({ ...minimal, port: '8080' })!.port).toBeUndefined();
    expect(parseDevice({ ...minimal, port: NaN })!.port).toBeUndefined();
  });
});

// ── parseLink ────────────────────────────────────────────────

describe('parseLink', () => {
  const minimal = { id: 'l1', sourceId: 'd1', targetId: 'd2' };

  it('parses minimal valid link with default type wired', () => {
    const l = parseLink(minimal)!;
    expect(l.id).toBe('l1');
    expect(l.sourceId).toBe('d1');
    expect(l.targetId).toBe('d2');
    expect(l.type).toBe('wired');
    expect(l.label).toBeUndefined();
  });

  it('returns null for missing or non-string id/sourceId/targetId', () => {
    expect(parseLink({ ...minimal, id: undefined })).toBeNull();
    expect(parseLink({ ...minimal, sourceId: 42 })).toBeNull();
    expect(parseLink({ ...minimal, targetId: null })).toBeNull();
    expect(parseLink(null)).toBeNull();
    expect(parseLink([])).toBeNull();
  });

  it('rejects attribute-injection payloads in any id field', () => {
    const payload = 'x" onmouseover="alert(1)';
    expect(parseLink({ ...minimal, id: payload })).toBeNull();
    expect(parseLink({ ...minimal, sourceId: payload })).toBeNull();
    expect(parseLink({ ...minimal, targetId: payload })).toBeNull();
  });

  it('only accepts "wireless"; anything else becomes "wired"', () => {
    expect(parseLink({ ...minimal, type: 'wireless' })!.type).toBe('wireless');
    expect(parseLink({ ...minimal, type: 'wired' })!.type).toBe('wired');
    expect(parseLink({ ...minimal, type: 'mystery' })!.type).toBe('wired');
    expect(parseLink({ ...minimal, type: undefined })!.type).toBe('wired');
  });

  it('truncates label, drops empty/non-string', () => {
    expect(parseLink({ ...minimal, label: 'short' })!.label).toBe('short');
    expect(parseLink({ ...minimal, label: 'x'.repeat(200) })!.label!.length).toBe(50);
    expect(parseLink({ ...minimal, label: '' })!.label).toBeUndefined();
    expect(parseLink({ ...minimal, label: 42 })!.label).toBeUndefined();
  });

  it('accepts the four valid side values, rejects anything else', () => {
    for (const side of ['top', 'bottom', 'left', 'right']) {
      expect(parseLink({ ...minimal, sourceSide: side })!.sourceSide).toBe(side);
      expect(parseLink({ ...minimal, targetSide: side })!.targetSide).toBe(side);
    }
    expect(parseLink({ ...minimal, sourceSide: 'TOP' })!.sourceSide).toBeUndefined();
    expect(parseLink({ ...minimal, sourceSide: 'middle' })!.sourceSide).toBeUndefined();
    expect(parseLink({ ...minimal, sourceSide: 42 })!.sourceSide).toBeUndefined();
    expect(parseLink({ ...minimal })!.sourceSide).toBeUndefined();
  });

  it('accepts a numeric port jack (1–256)', () => {
    expect(parseLink({ ...minimal, sourcePort: 1 })!.sourcePort).toBe(1);
    expect(parseLink({ ...minimal, sourcePort: 24 })!.sourcePort).toBe(24);
    expect(parseLink({ ...minimal, sourcePort: 256 })!.sourcePort).toBe(256);
  });

  it('coerces numeric strings to numbers; rejects non-numeric strings outside the named set', () => {
    expect(parseLink({ ...minimal, sourcePort: '3' })!.sourcePort).toBe(3);
    expect(parseLink({ ...minimal, sourcePort: 'random' })!.sourcePort).toBeUndefined();
    expect(parseLink({ ...minimal, sourcePort: 'eth0' })!.sourcePort).toBeUndefined();
  });

  it('rejects out-of-range, fractional, or non-integer ports', () => {
    expect(parseLink({ ...minimal, sourcePort: 0 })!.sourcePort).toBeUndefined();
    expect(parseLink({ ...minimal, sourcePort: -1 })!.sourcePort).toBeUndefined();
    expect(parseLink({ ...minimal, sourcePort: 1.5 })!.sourcePort).toBeUndefined();
    expect(parseLink({ ...minimal, sourcePort: 257 })!.sourcePort).toBeUndefined();
    expect(parseLink({ ...minimal, sourcePort: NaN })!.sourcePort).toBeUndefined();
    expect(parseLink({ ...minimal, sourcePort: Infinity })!.sourcePort).toBeUndefined();
  });

  it('accepts named ports (WAN, LAN, LINK, SFP, POE, MGMT, TRUNK)', () => {
    for (const name of ['WAN', 'LAN', 'LINK', 'SFP', 'POE', 'MGMT', 'TRUNK']) {
      expect(parseLink({ ...minimal, sourcePort: name })!.sourcePort).toBe(name);
      expect(parseLink({ ...minimal, targetPort: name })!.targetPort).toBe(name);
    }
    // Lowercase / partial / made-up names are rejected
    expect(parseLink({ ...minimal, sourcePort: 'wan' })!.sourcePort).toBeUndefined();
    expect(parseLink({ ...minimal, sourcePort: 'INTERNET' })!.sourcePort).toBeUndefined();
  });
});

// ── parseMap ─────────────────────────────────────────────────

describe('parseMap', () => {
  it('returns null for non-object or missing id/name', () => {
    expect(parseMap(null)).toBeNull();
    expect(parseMap({ name: 'home' })).toBeNull();
    expect(parseMap({ id: 'm1' })).toBeNull();
    expect(parseMap({ id: 42, name: 'home' })).toBeNull();
  });

  it('rejects a map id with attribute-injection characters', () => {
    expect(parseMap({ id: 'm1" onmouseover="alert(1)', name: 'home' })).toBeNull();
  });

  it('drops a device whose id carries an injection payload', () => {
    const m = parseMap({
      id: 'm1',
      name: 'home',
      devices: [
        { id: 'd1', name: 'ok', type: 'client' },
        { id: 'x" onmouseover="alert(1)', name: 'evil', type: 'client' },
      ],
    })!;
    expect(m.devices.map(d => d.id)).toEqual(['d1']);
  });

  it('parses a minimal valid map with empty devices/links', () => {
    const m = parseMap({ id: 'm1', name: 'home' })!;
    expect(m.id).toBe('m1');
    expect(m.name).toBe('home');
    expect(m.devices).toEqual([]);
    expect(m.links).toEqual([]);
    expect(typeof m.createdAt).toBe('string');
    expect(typeof m.updatedAt).toBe('string');
  });

  it('truncates oversized map name', () => {
    const m = parseMap({ id: 'm1', name: 'x'.repeat(500) })!;
    expect(m.name.length).toBe(200);
  });

  it('preserves createdAt/updatedAt when given as strings', () => {
    const ts = '2025-01-01T00:00:00.000Z';
    const m = parseMap({ id: 'm1', name: 'home', createdAt: ts, updatedAt: ts })!;
    expect(m.createdAt).toBe(ts);
    expect(m.updatedAt).toBe(ts);
  });

  it('drops invalid devices and continues', () => {
    const m = parseMap({
      id: 'm1',
      name: 'home',
      devices: [
        { id: 'd1', name: 'ok', type: 'client' },
        'not-an-object',
        null,
        { id: 'd2', name: 'also-ok', type: 'client' },
      ],
    })!;
    expect(m.devices.map(d => d.id)).toEqual(['d1', 'd2']);
  });

  it('drops links whose endpoints are not in the map', () => {
    const m = parseMap({
      id: 'm1',
      name: 'home',
      devices: [
        { id: 'd1', name: 'a', type: 'client' },
        { id: 'd2', name: 'b', type: 'client' },
      ],
      links: [
        { id: 'l-ok', sourceId: 'd1', targetId: 'd2' },
        { id: 'l-orphan-src', sourceId: 'ghost', targetId: 'd2' },
        { id: 'l-orphan-tgt', sourceId: 'd1', targetId: 'ghost' },
      ],
    })!;
    expect(m.links.map(l => l.id)).toEqual(['l-ok']);
  });

  it('clears unresolved hostId references on devices', () => {
    const m = parseMap({
      id: 'm1',
      name: 'home',
      devices: [
        { id: 'host', name: 'host', type: 'server' },
        { id: 'vm1', name: 'vm', type: 'vm', hostId: 'host' },
        { id: 'orphan', name: 'orphan', type: 'vm', hostId: 'ghost' },
      ],
    })!;
    expect(m.devices.find(d => d.id === 'vm1')!.hostId).toBe('host');
    expect(m.devices.find(d => d.id === 'orphan')!.hostId).toBeUndefined();
  });

  it('caps the devices array before parsing', () => {
    const m = parseMap({
      id: 'm1',
      name: 'home',
      devices: Array.from({ length: MAX_DEVICES_PER_MAP + 50 }, (_, i) => ({
        id: `d${i}`,
        name: `d${i}`,
        type: 'client',
      })),
    })!;
    expect(m.devices.length).toBe(MAX_DEVICES_PER_MAP);
  });

  it('caps the links array before parsing (with endpoints that all exist)', () => {
    // Single shared device, every link is a self-loop pointing at it, so the
    // endpoint filter can't remove anything — what's left is purely the cap.
    const m = parseMap({
      id: 'm1',
      name: 'home',
      devices: [{ id: 'd0', name: 'd0', type: 'client' }],
      links: Array.from({ length: MAX_LINKS_PER_MAP + 50 }, (_, i) => ({
        id: `l${i}`,
        sourceId: 'd0',
        targetId: 'd0',
      })),
    })!;
    expect(m.links.length).toBe(MAX_LINKS_PER_MAP);
  });
});

// ── parseCustomIcon ──────────────────────────────────────────

describe('parseCustomIcon', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';
  const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  it('parses a valid SVG icon', () => {
    const ic = parseCustomIcon({ id: 'i1', name: 'circle', kind: 'svg', data: svg })!;
    expect(ic.id).toBe('i1');
    expect(ic.name).toBe('circle');
    expect(ic.kind).toBe('svg');
    expect(ic.data).toContain('<svg');
    expect(ic.data).toContain('<circle');
  });

  it('parses a valid image icon (png base64)', () => {
    const ic = parseCustomIcon({ id: 'i2', name: 'pic', kind: 'image', data: pngDataUrl })!;
    expect(ic.kind).toBe('image');
    expect(ic.data).toBe(pngDataUrl);
  });

  it('parses jpeg data URL', () => {
    const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    expect(parseCustomIcon({ id: 'i3', name: 'p', kind: 'image', data: jpg })!.data).toBe(jpg);
  });

  it('returns null for missing or wrong-type fields', () => {
    expect(parseCustomIcon(null)).toBeNull();
    expect(parseCustomIcon({ name: 'x', kind: 'svg', data: svg })).toBeNull();
    expect(parseCustomIcon({ id: 'i1', kind: 'svg', data: svg })).toBeNull();
    expect(parseCustomIcon({ id: 'i1', name: 'x', kind: 'svg' })).toBeNull();
    expect(parseCustomIcon({ id: 'i1', name: 'x', kind: 'mystery', data: svg })).toBeNull();
  });

  it('rejects an icon id with attribute-injection characters', () => {
    expect(parseCustomIcon({ id: 'i1" onmouseover="alert(1)', name: 'x', kind: 'svg', data: svg })).toBeNull();
  });

  it('rejects oversized data before sanitizing', () => {
    const huge = 'x'.repeat(400 * 1024);
    expect(parseCustomIcon({ id: 'i1', name: 'x', kind: 'svg', data: huge })).toBeNull();
  });

  it('rejects image data URLs that are not png/jpeg base64', () => {
    expect(parseCustomIcon({ id: 'i1', name: 'x', kind: 'image', data: 'data:image/gif;base64,abc' })).toBeNull();
    expect(parseCustomIcon({ id: 'i1', name: 'x', kind: 'image', data: 'http://evil/x.png' })).toBeNull();
    expect(parseCustomIcon({ id: 'i1', name: 'x', kind: 'image', data: 'data:image/png;base64,!!!' })).toBeNull();
  });

  it('never lets a <script> tag through (sanitized or rejected)', () => {
    const bad = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    // sanitizeSvg can either reject (return null) or strip the script tag.
    // Both are acceptable; what's never acceptable is a non-null result that
    // still contains <script>. The combined assertion catches that regression
    // even if the sanitizer is rewritten to be less strict.
    const ic = parseCustomIcon({ id: 'i1', name: 'x', kind: 'svg', data: bad });
    const safe = ic === null || !/<script/i.test(ic.data);
    expect(safe).toBe(true);
  });

  it('truncates oversized name', () => {
    const ic = parseCustomIcon({ id: 'i1', name: 'n'.repeat(500), kind: 'svg', data: svg })!;
    expect(ic.name.length).toBe(100);
  });

  it('preserves createdAt when string, defaults to now otherwise', () => {
    const ts = '2025-01-01T00:00:00.000Z';
    expect(parseCustomIcon({ id: 'i1', name: 'x', kind: 'svg', data: svg, createdAt: ts })!.createdAt).toBe(ts);
    expect(typeof parseCustomIcon({ id: 'i1', name: 'x', kind: 'svg', data: svg })!.createdAt).toBe('string');
  });
});

// ── parseCustomIcons ─────────────────────────────────────────

describe('parseCustomIcons', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';

  it('returns [] for non-array', () => {
    expect(parseCustomIcons(null)).toEqual([]);
    expect(parseCustomIcons('nope')).toEqual([]);
    expect(parseCustomIcons({})).toEqual([]);
  });

  it('drops invalid icons and keeps valid ones', () => {
    const result = parseCustomIcons([
      { id: 'i1', name: 'good', kind: 'svg', data: svg },
      'garbage',
      null,
      { id: 'i2', name: 'good2', kind: 'svg', data: svg },
    ]);
    expect(result.map(i => i.id)).toEqual(['i1', 'i2']);
  });

  it('caps at MAX_CUSTOM_ICONS', () => {
    const many = Array.from({ length: MAX_CUSTOM_ICONS + 10 }, (_, i) => ({
      id: `i${i}`,
      name: `n${i}`,
      kind: 'svg' as const,
      data: svg,
    }));
    expect(parseCustomIcons(many).length).toBe(MAX_CUSTOM_ICONS);
  });
});
