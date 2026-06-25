import { getState, setState } from '../../state';
import { getActiveMap } from '../../storage';
import { showDeviceModal } from './device';
import { showConnectionModal, showEditConnectionModal } from './connection';
import { showNewMapModal } from './new-map';
import { showExportBundleModal } from './export-bundle';
import { showDeleteConfirm } from './delete-confirm';

/**
 * Wire the `netgraph:*` modal events to their dialog openers. Each opener lives
 * in its own module; this file is just the event-routing shell. Delete-device
 * routes through a confirm dialog; delete-connection has no dialog (it's a
 * one-click action), so its mutation is inline here.
 */
export function initModals(): void {
  document.addEventListener('netgraph:add-device', ((e: CustomEvent) => {
    const { x, y } = e.detail;
    showDeviceModal(null, x, y);
  }) as EventListener);

  document.addEventListener('netgraph:edit-device', ((e: CustomEvent) => {
    const { deviceId } = e.detail;
    const map = getActiveMap(getState());
    const device = map.devices.find(d => d.id === deviceId);
    if (device) showDeviceModal(device);
  }) as EventListener);

  document.addEventListener('netgraph:delete-device', ((e: CustomEvent) => {
    const { deviceId } = e.detail;
    showDeleteConfirm(deviceId);
  }) as EventListener);

  document.addEventListener('netgraph:add-connection', ((e: CustomEvent) => {
    const { deviceId } = e.detail;
    showConnectionModal(deviceId);
  }) as EventListener);

  document.addEventListener('netgraph:add-connected-device', ((e: CustomEvent) => {
    const { sourceId } = e.detail;
    showDeviceModal(null, undefined, undefined, sourceId);
  }) as EventListener);

  document.addEventListener('netgraph:new-map', () => {
    showNewMapModal();
  });

  document.addEventListener('netgraph:export-bundle', () => {
    showExportBundleModal();
  });

  document.addEventListener('netgraph:edit-connection', ((e: CustomEvent) => {
    const { linkId } = e.detail;
    showEditConnectionModal(linkId);
  }) as EventListener);

  document.addEventListener('netgraph:delete-connection', ((e: CustomEvent) => {
    const { linkId } = e.detail;
    const state = getState();
    const map = getActiveMap(state);
    map.links = map.links.filter(l => l.id !== linkId);
    map.updatedAt = new Date().toISOString();
    setState(state);
  }) as EventListener);
}
