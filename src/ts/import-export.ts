/**
 * File-based import/export.
 *
 * Two formats are supported, distinguished by the `kind` field:
 *
 *   { version: 1, kind: "map",    map,           customIcons }
 *   { version: 1, kind: "bundle", maps, activeMapId, customIcons }
 *
 * `customIcons` always contains *only* the icons referenced by the included
 * map(s). Importers translate icon IDs through a conflict-resolution pass so
 * incoming icons never clobber the user's existing library.
 */

import type { AppState, CustomIcon, NetworkMap } from './types';
import { parseMap, parseCustomIcons, isObject } from './parse-shapes';

const EXPORT_VERSION = 1;

// Files larger than this are rejected outright - well above any realistic
// real-world export.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// -- Export ---------------------------------------------------

export interface SingleMapExport {
  version: number;
  kind: 'map';
  map: NetworkMap;
  customIcons: CustomIcon[];
}

export interface BundleExport {
  version: number;
  kind: 'bundle';
  activeMapId: string;
  maps: NetworkMap[];
  customIcons: CustomIcon[];
}

/** Build a single-map export, inlining any custom icons it references. */
export function exportMap(map: NetworkMap, allCustomIcons: CustomIcon[]): SingleMapExport {
  const ids = referencedCustomIconIds(map);
  return {
    version: EXPORT_VERSION,
    kind: 'map',
    map: structuredClone(map),
    customIcons: allCustomIcons.filter(c => ids.has(c.id)).map(c => structuredClone(c)),
  };
}

/** Build a full-state export, inlining every custom icon. */
export function exportBundle(state: AppState): BundleExport {
  return {
    version: EXPORT_VERSION,
    kind: 'bundle',
    activeMapId: state.activeMapId,
    maps: state.maps.map(x => structuredClone(x)),
    customIcons: (state.customIcons ?? []).map(x => structuredClone(x)),
  };
}

/**
 * Trigger a browser download of the given JSON payload. `name` is the file
 * stem (no extension) and is sanitized for filesystem safety.
 */
export function downloadJson(name: string, payload: unknown): void {
  const safeName = sanitizeFileName(name) || 'netgraph-export';
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function referencedCustomIconIds(map: NetworkMap): Set<string> {
  const out = new Set<string>();
  for (const d of map.devices) {
    if (d.iconId?.startsWith('custom:')) out.add(d.iconId.slice('custom:'.length));
  }
  return out;
}

// -- Import / parse -------------------------------------------

export interface ParsedImport {
  kind: 'map' | 'bundle';
  /** Maps to import (one for kind='map', N for kind='bundle'). */
  maps: NetworkMap[];
  /** Bundle's activeMapId if applicable - used when the user picks "replace everything". */
  activeMapId?: string;
  /** Custom icons referenced by the maps, with their original IDs preserved. */
  customIcons: CustomIcon[];
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * Parse a JSON string into a ParsedImport. Performs all validation: file size,
 * shape, value coercion, capping. Throws ImportError on any rejection so the
 * caller can show a single actionable message.
 *
 * The parsed structure is *internally consistent* - any link or hostId that
 * pointed at a missing device is stripped - but icon name/ID conflicts with
 * the user's existing library are NOT resolved here. That's the next layer
 * up's job.
 */
export function parseImport(text: string): ParsedImport {
  if (text.length > MAX_FILE_BYTES) {
    throw new ImportError(`File is too large (${formatBytes(text.length)}). Maximum is ${formatBytes(MAX_FILE_BYTES)}.`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('File is not valid JSON.');
  }

  if (!isObject(raw)) throw new ImportError('Unexpected file shape - root must be an object.');
  if (raw.version !== EXPORT_VERSION) {
    throw new ImportError(`Unsupported file version: ${raw.version}. Expected ${EXPORT_VERSION}.`);
  }

  if (raw.kind === 'map') {
    const map = parseMap(raw.map);
    if (!map) throw new ImportError('Map data is missing or malformed.');
    const customIcons = parseCustomIcons(raw.customIcons);
    return { kind: 'map', maps: [map], customIcons };
  }

  if (raw.kind === 'bundle') {
    const list = Array.isArray(raw.maps) ? raw.maps : [];
    const maps = list.map(parseMap).filter(Boolean) as NetworkMap[];
    if (maps.length === 0) throw new ImportError('Bundle contains no usable maps.');
    const customIcons = parseCustomIcons(raw.customIcons);
    const activeMapId = typeof raw.activeMapId === 'string' && maps.some(m => m.id === raw.activeMapId)
      ? raw.activeMapId
      : maps[0].id;
    return { kind: 'bundle', maps, activeMapId, customIcons };
  }

  throw new ImportError(`Unknown export kind: "${String(raw.kind)}".`);
}

// -- Helpers --------------------------------------------------

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
