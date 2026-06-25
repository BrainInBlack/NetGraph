import type { AppState, NetworkMap } from './types';
import { parseMap, parseCustomIcons, isObject } from './parse-shapes';
import { generateId } from './util';
import { createExampleMap, exampleCustomIcons } from './example-map';

const STORAGE_KEY = 'netgraph-state';

/** A blank-canvas map for users who don't want the example. */
export function createEmptyMap(name: string): NetworkMap {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    devices: [],
    links: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createDefaultState(): AppState {
  // Brand-new install gets the example so the user sees what's possible.
  const map = createExampleMap('Example Network');
  return { activeMapId: map.id, maps: [map], customIcons: exampleCustomIcons() };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    return migrate(parsed) ?? createDefaultState();
  } catch {
    return createDefaultState();
  }
}

/**
 * localStorage quota exceeded. By the time this throws the in-memory state has
 * already been mutated (see docs/ARCHITECTURE.md "Known caveats"); the message tells the
 * user how to recover without losing the change.
 */
export class StorageQuotaError extends Error {
  constructor() {
    super(
      'Browser storage is full. Your last change will not be saved.\n\n'
      + 'To recover: delete some maps or custom icons via the toolbar menu, '
      + 'then try the change again. Avoid reloading the page first — that '
      + 'will discard the unsaved change.',
    );
    this.name = 'StorageQuotaError';
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // QuotaExceededError varies by browser; fall back to error-name + message check
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
      throw new StorageQuotaError();
    }
    throw err;
  }
}

export function getActiveMap(state: AppState): NetworkMap {
  return state.maps.find(m => m.id === state.activeMapId) ?? state.maps[0];
}

// ── Migration / validation ───────────────────────────────────

/**
 * Take whatever was parsed from localStorage and coerce it into a valid
 * `AppState`. Per-field cleanup lives in `parse-shapes.ts` (shared with the
 * file-import path); this function just stitches the top-level pieces.
 */
function migrate(raw: unknown): AppState | null {
  if (!isObject(raw)) return null;

  const maps = Array.isArray(raw.maps)
    ? (raw.maps.map(parseMap).filter(Boolean) as NetworkMap[])
    : [];
  if (maps.length === 0) return null;

  const activeMapId = typeof raw.activeMapId === 'string' && maps.some(m => m.id === raw.activeMapId)
    ? raw.activeMapId
    : maps[0].id;

  return {
    activeMapId,
    maps,
    customIcons: parseCustomIcons(raw.customIcons),
  };
}
