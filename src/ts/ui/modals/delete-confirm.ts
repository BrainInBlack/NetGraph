import { getState, setState, setSelectedDeviceId } from '../../state';
import { getActiveMap } from '../../storage';
import { escapeHtml, q } from '../../util';
import { closePanel } from '../sidebar';
import { showModal, dismissModal } from './shared';

// -- Delete Confirmation --------------------------------------

export function showDeleteConfirm(deviceId: string): void {
  const state = getState();
  const map = getActiveMap(state);
  const device = map.devices.find(d => d.id === deviceId);
  if (!device) return;

  const modal = showModal(`
    <div class="modal-header">Delete Device</div>
    <div class="modal-body">
      <p>Delete <strong>${escapeHtml(device.name)}</strong>? This will also remove all its connections.</p>
    </div>
    <div class="modal-footer">
      <button class="modal-btn secondary" id="modal-cancel">Cancel</button>
      <button class="modal-btn danger" id="modal-confirm">Delete</button>
    </div>
  `);

  q(modal, '#modal-cancel').addEventListener('click', dismissModal);
  q(modal, '#modal-confirm').addEventListener('click', () => {
    const state = getState();
    const map = getActiveMap(state);
    map.devices = map.devices.filter(d => d.id !== deviceId);
    map.links = map.links.filter(l => l.sourceId !== deviceId && l.targetId !== deviceId);
    // Also clear hostId references
    map.devices.forEach(d => { if (d.hostId === deviceId) d.hostId = undefined; });
    map.updatedAt = new Date().toISOString();
    setState(state);
    setSelectedDeviceId(null);
    closePanel();
    dismissModal();
  });
}
