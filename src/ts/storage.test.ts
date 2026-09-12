import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadState, saveState, getActiveMap, createEmptyMap, StorageQuotaError } from './storage';
import type { AppState, NetworkMap } from './types';

// Must match STORAGE_KEY in storage.ts - needed to plant raw/corrupt data
// that can't go through saveState.
const KEY = 'netgraph-state';

// We want a clean in-memory `localStorage` per test, so storage.ts (which uses
// the bare `localStorage` global) exercises the real load/save/migrate paths.
// Older vitest's happy-dom env supplied no working localStorage at all; vitest 5
// defines a getter-only one on the window, which a plain assignment throws
// against - so install it with defineProperty, which works in both.
function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null,
  } as Storage;
}

function map(over: Partial<NetworkMap> = {}): NetworkMap {
  return { id: 'm1', name: 'Map', devices: [], links: [], createdAt: 't', updatedAt: 't', ...over };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: makeStorage(),
    configurable: true,
    writable: true,
  });
});
afterEach(() => vi.restoreAllMocks());

// -- createEmptyMap ----------------------------------------------

describe('createEmptyMap', () => {
  it('returns a blank map with the given name and a generated id', () => {
    const m = createEmptyMap('Lab');
    expect(m.name).toBe('Lab');
    expect(m.id.length).toBeGreaterThan(0);
    expect(m.devices).toEqual([]);
    expect(m.links).toEqual([]);
    expect(typeof m.createdAt).toBe('string');
  });

  it('gives each map a distinct id', () => {
    expect(createEmptyMap('a').id).not.toBe(createEmptyMap('b').id);
  });
});

// -- getActiveMap ------------------------------------------------

describe('getActiveMap', () => {
  it('returns the map matching activeMapId', () => {
    const state: AppState = { activeMapId: 'm2', maps: [map({ id: 'm1' }), map({ id: 'm2' })] };
    expect(getActiveMap(state).id).toBe('m2');
  });

  it('falls back to the first map when activeMapId matches nothing', () => {
    const state: AppState = { activeMapId: 'ghost', maps: [map({ id: 'm1' }), map({ id: 'm2' })] };
    expect(getActiveMap(state).id).toBe('m1');
  });
});

// -- loadState ---------------------------------------------------

describe('loadState', () => {
  it('returns a seeded default state when nothing is stored', () => {
    const state = loadState();
    expect(state.maps.length).toBeGreaterThan(0);
    expect(getActiveMap(state)).toBeDefined();
  });

  it('loads a valid stored state', () => {
    localStorage.setItem(KEY, JSON.stringify({
      activeMapId: 'm1',
      maps: [map({ id: 'm1', name: 'Stored' })],
      customIcons: [],
    }));
    const state = loadState();
    expect(state.maps).toHaveLength(1);
    expect(state.maps[0].name).toBe('Stored');
    expect(state.activeMapId).toBe('m1');
  });

  it('falls back to default state on corrupt JSON', () => {
    localStorage.setItem(KEY, '{not valid json');
    expect(loadState().maps.length).toBeGreaterThan(0);
  });

  it('falls back to default state when the stored object has no usable maps', () => {
    localStorage.setItem(KEY, JSON.stringify({ maps: [] }));
    expect(loadState().maps.length).toBeGreaterThan(0);
  });

  it('falls back to default state when the stored root is not an object', () => {
    localStorage.setItem(KEY, '42');
    expect(loadState().maps.length).toBeGreaterThan(0);
  });

  it('repairs an activeMapId that points at no map', () => {
    localStorage.setItem(KEY, JSON.stringify({
      activeMapId: 'ghost',
      maps: [map({ id: 'real' })],
    }));
    expect(loadState().activeMapId).toBe('real');
  });
});

// -- saveState ---------------------------------------------------

describe('saveState', () => {
  it('round-trips through loadState', () => {
    const state: AppState = {
      activeMapId: 'm1',
      maps: [map({ id: 'm1', name: 'Persisted' })],
      customIcons: [],
    };
    saveState(state);
    const loaded = loadState();
    expect(loaded.maps[0].id).toBe('m1');
    expect(loaded.maps[0].name).toBe('Persisted');
    expect(loaded.activeMapId).toBe('m1');
  });

  it('throws StorageQuotaError when the browser quota is exceeded', () => {
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => saveState({ activeMapId: 'm1', maps: [map()] })).toThrow(StorageQuotaError);
  });

  it('rethrows non-quota errors untouched', () => {
    const boom = new Error('disk on fire');
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => { throw boom; });
    expect(() => saveState({ activeMapId: 'm1', maps: [map()] })).toThrow(boom);
  });
});
