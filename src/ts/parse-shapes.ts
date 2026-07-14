/**
 * Shape parsers + validators for the persisted data model.
 *
 * Used in two places that previously had near-duplicate copies:
 *   - `storage.ts migrate*` - loading from localStorage at startup
 *   - `import-export.ts parse*` - accepting a JSON file the user uploaded
 *
 * Both flows need the same defensive treatment: unknown extra fields pass
 * through, missing required fields fail (return null), out-of-bounds values
 * are clamped, references that don't resolve are stripped, SVG content is
 * sanitized. Consolidating them here means a fix in one place propagates
 * everywhere.
 */

import type { CustomIcon, Device, DeviceType, Link, LinkPort, LinkSide, NamedPort, NetworkMap } from './types';
import { NAMED_PORTS } from './types';
import { sanitizeSvg } from './svg-sanitizer';
import { DEVICE_WIDTH_MIN, DEVICE_WIDTH_MAX, MAX_NOTES_LENGTH } from './device-config';

// Per-field length caps. Generous enough not to surprise users with real
// data, tight enough to reject obvious abuse.
const MAX_NAME_LEN = 200;
const MAX_DOMAIN_LEN = 200;
const MAX_IP_LEN = 100;
const MAX_MAC_LEN = 50;
const MAX_TAG_LEN = 50;
const MAX_TAGS_PER_DEVICE = 50;
const MAX_LABEL_LEN = 50;
const MAX_HOST_ID_LEN = 100;
const MAX_ICON_ID_LEN = 200;
const MAX_ICON_NAME_LEN = 100;
const MAX_ICON_DATA_LEN = 384 * 1024; // ~256 KB raw + base64 inflation headroom

// Array caps applied before per-element parsing so a hand-edited file with
// a million-element array can't lock the tab parsing it.
export const MAX_DEVICES_PER_MAP = 1000;
export const MAX_LINKS_PER_MAP = 2000;
export const MAX_CUSTOM_ICONS = 200;

const DEVICE_TYPE_VALUES = new Set<DeviceType>(['modem', 'gateway', 'switch', 'ap', 'server', 'vm', 'client']);
const LINK_SIDE_VALUES = new Set<LinkSide>(['top', 'bottom', 'left', 'right']);
const NAMED_PORT_VALUES = new Set<NamedPort>(NAMED_PORTS);

// Cap for the numeric port jack number. 256 covers the largest enterprise
// switches sold today; anything bigger is almost certainly garbage.
const MAX_PORT_NUMBER = 256;

// -- Public parsers -------------------------------------------

export function parseMap(raw: unknown): NetworkMap | null {
  if (!isObject(raw)) return null;
  const id = validateId(raw.id);
  if (id === null || typeof raw.name !== 'string') return null;

  const devicesIn = Array.isArray(raw.devices) ? raw.devices.slice(0, MAX_DEVICES_PER_MAP) : [];
  const linksIn = Array.isArray(raw.links) ? raw.links.slice(0, MAX_LINKS_PER_MAP) : [];

  const devices = devicesIn.map(parseDevice).filter(Boolean) as Device[];
  const links = linksIn.map(parseLink).filter(Boolean) as Link[];

  // Drop links whose endpoints aren't in the map; clear hostId references that don't resolve
  const ids = new Set(devices.map(d => d.id));
  const validLinks = links.filter(l => ids.has(l.sourceId) && ids.has(l.targetId));
  for (const d of devices) {
    if (d.hostId && !ids.has(d.hostId)) d.hostId = undefined;
  }

  const now = new Date().toISOString();
  return {
    id,
    name: raw.name.slice(0, MAX_NAME_LEN),
    devices,
    links: validLinks,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

export function parseDevice(raw: unknown): Device | null {
  if (!isObject(raw)) return null;
  const id = validateId(raw.id);
  if (id === null || typeof raw.name !== 'string') return null;
  const type: DeviceType = DEVICE_TYPE_VALUES.has(raw.type as DeviceType)
    ? (raw.type as DeviceType)
    : 'client';
  return {
    id,
    name: raw.name.slice(0, MAX_NAME_LEN),
    type,
    ip: optionalString(raw.ip, MAX_IP_LEN),
    port: finiteNumber(raw.port),
    domain: optionalString(raw.domain, MAX_DOMAIN_LEN),
    mac: optionalString(raw.mac, MAX_MAC_LEN),
    tags: Array.isArray(raw.tags)
      ? raw.tags
          .filter((t): t is string => typeof t === 'string')
          .map(t => t.slice(0, MAX_TAG_LEN))
          .slice(0, MAX_TAGS_PER_DEVICE)
      : [],
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, MAX_NOTES_LENGTH) : '',
    x: finiteNumber(raw.x) ?? 0,
    y: finiteNumber(raw.y) ?? 0,
    hostId: optionalString(raw.hostId, MAX_HOST_ID_LEN),
    iconId: parseIconId(raw.iconId),
    width: clampWidth(raw.width),
  };
}

export function parseLink(raw: unknown): Link | null {
  if (!isObject(raw)) return null;
  const id = validateId(raw.id);
  const sourceId = validateId(raw.sourceId);
  const targetId = validateId(raw.targetId);
  if (id === null || sourceId === null || targetId === null) {
    return null;
  }
  return {
    id,
    sourceId,
    targetId,
    type: raw.type === 'wireless' ? 'wireless' : 'wired',
    label: optionalString(raw.label, MAX_LABEL_LEN),
    sourceSide: parseLinkSide(raw.sourceSide),
    targetSide: parseLinkSide(raw.targetSide),
    sourcePort: parseLinkPort(raw.sourcePort),
    targetPort: parseLinkPort(raw.targetPort),
  };
}

/**
 * Parse a custom icon. Imported SVG data is run through the allow-list
 * sanitizer; image data URLs must match the expected base64 shape exactly.
 * The cap on data length is enforced before sanitization to bound work.
 */
export function parseCustomIcon(raw: unknown): CustomIcon | null {
  if (!isObject(raw)) return null;
  const id = validateId(raw.id);
  if (id === null || typeof raw.name !== 'string' || typeof raw.data !== 'string') return null;
  if (raw.kind !== 'svg' && raw.kind !== 'image') return null;
  if (raw.data.length > MAX_ICON_DATA_LEN) return null;

  let data: string;
  if (raw.kind === 'svg') {
    const sanitized = sanitizeSvg(raw.data);
    if (!sanitized) return null;
    data = sanitized;
  } else {
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(raw.data)) return null;
    data = raw.data;
  }

  return {
    id,
    name: raw.name.slice(0, MAX_ICON_NAME_LEN),
    kind: raw.kind,
    data,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

export function parseCustomIcons(raw: unknown): CustomIcon[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_CUSTOM_ICONS)
    .map(parseCustomIcon)
    .filter(Boolean) as CustomIcon[];
}

// -- Helpers --------------------------------------------------

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// IDs are app-internal crypto.randomUUID() values. Imported IDs are only used
// as transient keys (the map id is regenerated on import; device/link ids are
// kept verbatim), so a strict format check is enough - and it must be strict,
// because these ids are interpolated raw into data-* attributes in the
// sidebar/toolbar. An id like `x" onmouseover="...` would otherwise break out of
// the attribute and execute. Reject anything outside the safe alphabet.
const ID_PATTERN = /^[a-zA-Z0-9_\-:]{1,128}$/;
function validateId(v: unknown): string | null {
  return typeof v === 'string' && ID_PATTERN.test(v) ? v : null;
}

function optionalString(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;
}

function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function parseIconId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw.startsWith('lucide:') || raw.startsWith('custom:')) return raw.slice(0, MAX_ICON_ID_LEN);
  return undefined;
}

function clampWidth(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (v < DEVICE_WIDTH_MIN || v > DEVICE_WIDTH_MAX) return undefined;
  return v;
}

function parseLinkSide(v: unknown): LinkSide | undefined {
  return typeof v === 'string' && LINK_SIDE_VALUES.has(v as LinkSide) ? (v as LinkSide) : undefined;
}

/**
 * A port is either a positive integer <= MAX_PORT_NUMBER or one of NAMED_PORTS.
 * Numbers stored as strings (e.g. "3" from a hand-edited JSON file) are
 * coerced. Everything else is rejected.
 */
function parseLinkPort(v: unknown): LinkPort | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_PORT_NUMBER) return v;
  if (typeof v === 'string') {
    if (NAMED_PORT_VALUES.has(v as NamedPort)) return v as NamedPort;
    // Numeric string - coerce
    if (/^\d+$/.test(v)) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 1 && n <= MAX_PORT_NUMBER) return n;
    }
  }
  return undefined;
}
