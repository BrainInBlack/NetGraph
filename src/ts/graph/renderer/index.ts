import type { NetworkMap } from '../../types';
import { renderDevices } from './devices';
import { renderConnections } from './connections';

/**
 * Render the whole map: device cards first (so the connection layer can read
 * their rendered geometry), then the connection lines on top.
 */
export function renderAll(
  map: NetworkMap,
  selectedId: string | null,
  selectedIds: Set<string>,
): void {
  renderDevices(map.devices, selectedId, selectedIds, map);
  renderConnections(map.links, map.devices);
}
