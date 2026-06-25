import type { Device, Link, NetworkMap } from '../types';

/**
 * Pure copy/paste helpers for select-mode's clipboard. Kept DOM-free + dep-
 * injected (the caller passes `generateId` and `snapToGrid`) so the logic
 * stays straightforwardly unit-testable — no spying on globals, no fake DOM.
 *
 * Rules:
 *   - A clipboard captures every selected device verbatim, plus only those
 *     links whose BOTH endpoints are in the selection. Half-attached links
 *     (one endpoint outside the selection) are dropped — pasting them would
 *     either point to the original device (re-connecting the copy to the
 *     original group, surprising) or dangle (broken state).
 *   - `hostId` follows the same rule: if the host device is in the selection
 *     it's remapped to the host's new id; otherwise it's cleared on the copy.
 *
 * Centroid math is in canvas units (matches Device.x/y).
 */

export interface Clipboard {
  /** Selected device records, with original ids. Used as paste sources. */
  devices: Device[];
  /** Links whose source AND target are in the selection. Original ids. */
  links: Link[];
  /** Mean x/y of the selected devices — the paste anchor point. */
  centerX: number;
  centerY: number;
}

export interface PastedItems {
  /** Fresh device records with new ids, repositioned around the paste anchor. */
  devices: Device[];
  /** Links with sourceId / targetId remapped to the new ids. */
  links: Link[];
  /** Set of new device ids — convenient to feed back into setSelectedDeviceIds. */
  newIds: Set<string>;
}

/**
 * Build a clipboard payload from the active map and a selection set.
 * Returns null when the selection contains no devices in the map.
 */
export function buildClipboard(map: NetworkMap, selectedIds: Set<string>): Clipboard | null {
  const devices = map.devices.filter(d => selectedIds.has(d.id));
  if (devices.length === 0) return null;

  const idSet = new Set(devices.map(d => d.id));
  const links = map.links.filter(l => idSet.has(l.sourceId) && idSet.has(l.targetId));

  let sumX = 0, sumY = 0;
  for (const d of devices) {
    sumX += d.x;
    sumY += d.y;
  }
  return {
    devices,
    links,
    centerX: sumX / devices.length,
    centerY: sumY / devices.length,
  };
}

/**
 * Place a clipboard at (anchorX, anchorY), generating fresh ids for every
 * device and remapping link endpoints + hostId references through the id map.
 * `anchorX`/`anchorY` is where the *centroid* of the copy lands; relative
 * positions between copied devices are preserved.
 */
export function pasteClipboard(
  clipboard: Clipboard,
  anchorX: number,
  anchorY: number,
  generateId: () => string,
  snapToGrid: (n: number) => number,
): PastedItems {
  const idMap = new Map<string, string>();
  for (const d of clipboard.devices) idMap.set(d.id, generateId());

  const dx = anchorX - clipboard.centerX;
  const dy = anchorY - clipboard.centerY;

  const devices: Device[] = clipboard.devices.map(d => {
    const newId = idMap.get(d.id)!;
    // hostId follows the intra-selection rule — drop refs to outside devices.
    const remappedHost = d.hostId ? idMap.get(d.hostId) : undefined;
    // NOTE: `...d` is a shallow spread. `tags` is explicitly re-copied below
    // because it's an array — without the explicit copy the paste would share
    // the same array reference as the source. Any FUTURE Device field that's
    // an array, Map, Set, or plain object needs the same treatment here;
    // otherwise pasted devices will silently mutate originals. Today `tags`
    // is the only such field — keep this list in sync if Device grows.
    return {
      ...d,
      id: newId,
      x: snapToGrid(d.x + dx),
      y: snapToGrid(d.y + dy),
      tags: [...d.tags],
      hostId: remappedHost,
    };
  });

  const links: Link[] = clipboard.links.map(l => ({
    ...l,
    id: generateId(),
    sourceId: idMap.get(l.sourceId)!,
    targetId: idMap.get(l.targetId)!,
  }));

  return {
    devices,
    links,
    newIds: new Set(idMap.values()),
  };
}
