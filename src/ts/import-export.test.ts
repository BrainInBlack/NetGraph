import { describe, it, expect } from 'vitest';
import { exportMap, exportBundle, parseImport, ImportError } from './import-export';
import type { AppState, CustomIcon, Device, NetworkMap } from './types';

function device(over: Partial<Device> = {}): Device {
  return { id: 'd1', name: 'Device', type: 'client', tags: [], notes: '', x: 0, y: 0, ...over };
}
function map(over: Partial<NetworkMap> = {}): NetworkMap {
  return { id: 'm1', name: 'Map', devices: [], links: [], createdAt: 't', updatedAt: 't', ...over };
}
function icon(id: string): CustomIcon {
  return { id, name: id, kind: 'image', data: 'data:image/png;base64,AAAA', createdAt: 't' };
}

// -- exportMap ---------------------------------------------------

describe('exportMap', () => {
  it('wraps the map with version + kind', () => {
    const out = exportMap(map(), []);
    expect(out.version).toBe(1);
    expect(out.kind).toBe('map');
  });

  it('deep-clones the map - no shared references with the input', () => {
    const m = map({ devices: [device()] });
    const out = exportMap(m, []);
    expect(out.map).not.toBe(m);
    expect(out.map.devices).not.toBe(m.devices);
    out.map.devices.push(device({ id: 'x' }));
    expect(m.devices).toHaveLength(1);
  });

  it('includes only the custom icons the map references', () => {
    const m = map({ devices: [device({ iconId: 'custom:keep' })] });
    const out = exportMap(m, [icon('keep'), icon('drop')]);
    expect(out.customIcons.map(c => c.id)).toEqual(['keep']);
  });

  it('includes no icons when the map references none', () => {
    const m = map({ devices: [device({ iconId: 'lucide:router' })] });
    expect(exportMap(m, [icon('keep')]).customIcons).toEqual([]);
  });
});

// -- exportBundle ------------------------------------------------

describe('exportBundle', () => {
  it('wraps full state with version, kind, and activeMapId', () => {
    const state: AppState = { activeMapId: 'm1', maps: [map()], customIcons: [] };
    const out = exportBundle(state);
    expect(out.version).toBe(1);
    expect(out.kind).toBe('bundle');
    expect(out.activeMapId).toBe('m1');
  });

  it('includes every custom icon, deep-cloned', () => {
    const ic = icon('a');
    const out = exportBundle({ activeMapId: 'm1', maps: [map()], customIcons: [ic] });
    expect(out.customIcons).toHaveLength(1);
    expect(out.customIcons[0]).not.toBe(ic);
  });

  it('tolerates missing customIcons', () => {
    expect(exportBundle({ activeMapId: 'm1', maps: [map()] }).customIcons).toEqual([]);
  });
});

// -- parseImport - rejections ------------------------------------

describe('parseImport - rejections', () => {
  it('rejects an oversized file', () => {
    const huge = 'a'.repeat(5 * 1024 * 1024 + 1);
    expect(() => parseImport(huge)).toThrow(ImportError);
    expect(() => parseImport(huge)).toThrow(/too large/);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseImport('{not json')).toThrow(/not valid JSON/);
  });

  it('rejects a non-object root', () => {
    expect(() => parseImport('[]')).toThrow(/root must be an object/);
    expect(() => parseImport('42')).toThrow(/root must be an object/);
  });

  it('rejects an unsupported version', () => {
    expect(() => parseImport(JSON.stringify({ version: 99, kind: 'map' })))
      .toThrow(/Unsupported file version/);
  });

  it('rejects an unknown kind', () => {
    expect(() => parseImport(JSON.stringify({ version: 1, kind: 'wat' })))
      .toThrow(/Unknown export kind/);
  });

  it('rejects kind=map with a malformed map', () => {
    expect(() => parseImport(JSON.stringify({ version: 1, kind: 'map', map: null })))
      .toThrow(/missing or malformed/);
  });

  it('rejects kind=bundle with no usable maps', () => {
    expect(() => parseImport(JSON.stringify({ version: 1, kind: 'bundle', maps: [] })))
      .toThrow(/no usable maps/);
    expect(() => parseImport(JSON.stringify({ version: 1, kind: 'bundle', maps: 'nope' })))
      .toThrow(/no usable maps/);
  });
});

// -- parseImport - success ---------------------------------------

describe('parseImport - success', () => {
  it('parses a single-map export', () => {
    const result = parseImport(JSON.stringify({ version: 1, kind: 'map', map: map(), customIcons: [] }));
    expect(result.kind).toBe('map');
    expect(result.maps).toHaveLength(1);
    expect(result.maps[0].id).toBe('m1');
  });

  it('parses a bundle and preserves a valid activeMapId', () => {
    const result = parseImport(JSON.stringify({
      version: 1, kind: 'bundle',
      activeMapId: 'm2',
      maps: [map({ id: 'm1' }), map({ id: 'm2' })],
      customIcons: [],
    }));
    expect(result.kind).toBe('bundle');
    expect(result.maps.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(result.activeMapId).toBe('m2');
  });

  it('falls back to the first map when activeMapId is missing or unknown', () => {
    const base = { version: 1, kind: 'bundle', maps: [map({ id: 'm1' }), map({ id: 'm2' })], customIcons: [] };
    expect(parseImport(JSON.stringify(base)).activeMapId).toBe('m1');
    expect(parseImport(JSON.stringify({ ...base, activeMapId: 'ghost' })).activeMapId).toBe('m1');
  });

  it('drops malformed maps in a bundle but keeps the valid ones', () => {
    const result = parseImport(JSON.stringify({
      version: 1, kind: 'bundle',
      maps: [map({ id: 'ok' }), null, { id: 5 }],
      customIcons: [],
    }));
    expect(result.maps.map(m => m.id)).toEqual(['ok']);
  });
});

// -- parseImport - round-trip ------------------------------------

describe('parseImport - round-trip', () => {
  it('exportBundle -> JSON -> parseImport preserves maps, active id, and icons', () => {
    const state: AppState = {
      activeMapId: 'm2',
      maps: [map({ id: 'm1', name: 'Home' }), map({ id: 'm2', name: 'Lab' })],
      customIcons: [icon('logo')],
    };
    const result = parseImport(JSON.stringify(exportBundle(state)));
    expect(result.kind).toBe('bundle');
    expect(result.maps.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(result.activeMapId).toBe('m2');
    expect(result.customIcons.map(c => c.id)).toEqual(['logo']);
  });

  it('exportMap -> JSON -> parseImport preserves the map and its referenced icon', () => {
    const m = map({ id: 'solo', devices: [device({ iconId: 'custom:logo' })] });
    const result = parseImport(JSON.stringify(exportMap(m, [icon('logo')])));
    expect(result.kind).toBe('map');
    expect(result.maps[0].id).toBe('solo');
    expect(result.customIcons.map(c => c.id)).toEqual(['logo']);
  });
});
