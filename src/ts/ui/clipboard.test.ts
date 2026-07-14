import { describe, it, expect } from 'vitest';
import { buildClipboard, pasteClipboard } from './clipboard';
import type { Device, Link, NetworkMap } from '../types';

// -- Test fixtures --------------------------------------------

function device(id: string, x: number, y: number, extra: Partial<Device> = {}): Device {
  return {
    id,
    name: id,
    type: 'server',
    tags: [],
    notes: '',
    x,
    y,
    ...extra,
  };
}

function link(id: string, sourceId: string, targetId: string): Link {
  return { id, sourceId, targetId, type: 'wired' };
}

function map(devices: Device[], links: Link[]): NetworkMap {
  return {
    id: 'map-1',
    name: 'test',
    devices,
    links,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

// Deterministic id source for paste tests
function idGen(): () => string {
  let n = 0;
  return () => `new-${++n}`;
}

const noSnap = (n: number) => n;

// -- buildClipboard -------------------------------------------

describe('buildClipboard', () => {
  it('returns null when no selected devices are present in the map', () => {
    const m = map([device('a', 0, 0)], []);
    expect(buildClipboard(m, new Set())).toBeNull();
    expect(buildClipboard(m, new Set(['nonexistent']))).toBeNull();
  });

  it('captures only the selected devices and computes the centroid', () => {
    const m = map([
      device('a', 100, 100),
      device('b', 300, 200),
      device('c', 500, 500),
    ], []);
    const clip = buildClipboard(m, new Set(['a', 'b']))!;
    expect(clip.devices.map(d => d.id)).toEqual(['a', 'b']);
    expect(clip.centerX).toBe(200);
    expect(clip.centerY).toBe(150);
  });

  it('keeps links whose both endpoints are in the selection', () => {
    const m = map(
      [device('a', 0, 0), device('b', 100, 0), device('c', 200, 0)],
      [
        link('l-ab', 'a', 'b'),
        link('l-bc', 'b', 'c'),
        link('l-ac', 'a', 'c'),
      ],
    );
    const clip = buildClipboard(m, new Set(['a', 'b']))!;
    expect(clip.links.map(l => l.id)).toEqual(['l-ab']);
  });

  it('drops half-attached links (one endpoint outside the selection)', () => {
    const m = map(
      [device('a', 0, 0), device('b', 100, 0)],
      [link('cross', 'a', 'b')],
    );
    const clip = buildClipboard(m, new Set(['a']))!;
    expect(clip.links).toEqual([]);
  });
});

// -- pasteClipboard -------------------------------------------

describe('pasteClipboard', () => {
  it('assigns fresh ids and remaps link endpoints', () => {
    const m = map(
      [device('a', 0, 0), device('b', 100, 0)],
      [link('l', 'a', 'b')],
    );
    const clip = buildClipboard(m, new Set(['a', 'b']))!;
    const out = pasteClipboard(clip, 50, 0, idGen(), noSnap);

    // Two devices with fresh ids
    expect(out.devices.map(d => d.id)).toEqual(['new-1', 'new-2']);
    // Link points at the new ids
    expect(out.links[0].sourceId).toBe('new-1');
    expect(out.links[0].targetId).toBe('new-2');
    // newIds set matches the new device ids
    expect([...out.newIds].sort()).toEqual(['new-1', 'new-2']);
  });

  it('translates the centroid to the anchor while preserving relative positions', () => {
    const m = map(
      [device('a', 0, 0), device('b', 200, 100)],  // centroid (100, 50)
      [],
    );
    const clip = buildClipboard(m, new Set(['a', 'b']))!;
    const out = pasteClipboard(clip, 500, 500, idGen(), noSnap);

    // Anchor at (500, 500), so devices land offset from the centroid (100, 50)
    expect(out.devices[0]).toMatchObject({ x: 400, y: 450 });
    expect(out.devices[1]).toMatchObject({ x: 600, y: 550 });
  });

  it('applies snap-to-grid to the pasted positions', () => {
    const snapTo24 = (n: number) => Math.round(n / 24) * 24;
    const m = map([device('a', 0, 0)], []);
    const clip = buildClipboard(m, new Set(['a']))!;
    const out = pasteClipboard(clip, 37, 13, idGen(), snapTo24);
    // 37 -> 48, 13 -> 24
    expect(out.devices[0]).toMatchObject({ x: 48, y: 24 });
  });

  it('remaps hostId when the host is in the selection', () => {
    const m = map(
      [device('host', 0, 0), device('vm', 100, 0, { hostId: 'host' })],
      [],
    );
    const clip = buildClipboard(m, new Set(['host', 'vm']))!;
    const out = pasteClipboard(clip, 50, 0, idGen(), noSnap);

    const newHostId = out.devices.find(d => d.name === 'host')!.id;
    const newVm = out.devices.find(d => d.name === 'vm')!;
    expect(newVm.hostId).toBe(newHostId);
  });

  it('drops hostId when the host is outside the selection', () => {
    const m = map(
      [device('host', 0, 0), device('vm', 100, 0, { hostId: 'host' })],
      [],
    );
    const clip = buildClipboard(m, new Set(['vm']))!;
    const out = pasteClipboard(clip, 50, 0, idGen(), noSnap);
    expect(out.devices[0].hostId).toBeUndefined();
  });

  it('does not share the tags array with the source device', () => {
    const m = map([device('a', 0, 0, { tags: ['x', 'y'] })], []);
    const clip = buildClipboard(m, new Set(['a']))!;
    const out = pasteClipboard(clip, 0, 0, idGen(), noSnap);
    out.devices[0].tags.push('z');
    // The original wasn't mutated through the clipboard
    expect(m.devices[0].tags).toEqual(['x', 'y']);
  });

  it('preserves every optional Device field through paste', () => {
    // Belt-and-braces against a future field being silently dropped by the
    // spread in pasteClipboard - if anyone adds a new field to Device, they
    // need to add it here too.
    const m = map([device('a', 0, 0, {
      ip: '10.0.0.1',
      port: 8080,
      domain: 'example.lan',
      mac: 'aa:bb:cc:dd:ee:ff',
      notes: 'rack 2 / shelf 3',
      iconId: 'lucide:server',
      width: 280,
      tags: ['prod', 'critical'],
    })], []);
    const clip = buildClipboard(m, new Set(['a']))!;
    const out = pasteClipboard(clip, 0, 0, idGen(), noSnap);
    const pasted = out.devices[0];
    expect(pasted.ip).toBe('10.0.0.1');
    expect(pasted.port).toBe(8080);
    expect(pasted.domain).toBe('example.lan');
    expect(pasted.mac).toBe('aa:bb:cc:dd:ee:ff');
    expect(pasted.notes).toBe('rack 2 / shelf 3');
    expect(pasted.iconId).toBe('lucide:server');
    expect(pasted.width).toBe(280);
    expect(pasted.tags).toEqual(['prod', 'critical']);
    // Name + type carry over too
    expect(pasted.name).toBe('a');
    expect(pasted.type).toBe('server');
  });

  it('preserves every optional Link field through paste', () => {
    // Same belt-and-braces guard for Link. If a Link field is added without
    // updating pasteClipboard's spread, this test catches the drop.
    const m = map(
      [device('a', 0, 0), device('b', 100, 0)],
      [{
        id: 'l',
        sourceId: 'a',
        targetId: 'b',
        type: 'wireless',
        label: '5 GHz',
        sourceSide: 'right',
        targetSide: 'left',
        sourcePort: 'WAN',
        targetPort: 42,
      }],
    );
    const clip = buildClipboard(m, new Set(['a', 'b']))!;
    const out = pasteClipboard(clip, 0, 0, idGen(), noSnap);
    const pasted = out.links[0];
    expect(pasted.type).toBe('wireless');
    expect(pasted.label).toBe('5 GHz');
    expect(pasted.sourceSide).toBe('right');
    expect(pasted.targetSide).toBe('left');
    expect(pasted.sourcePort).toBe('WAN');
    expect(pasted.targetPort).toBe(42);
  });
});
