import { getState, setState } from '../../state';
import { getActiveMap } from '../../storage';
import { bindRadioGroupKeys, generateId, escapeHtml, linkExists, nextFrame, q } from '../../util';
import { autoPosition } from '../../graph/layout';
import { DEVICE_TYPES, TYPE_LABELS, MAX_NOTES_LENGTH, DEVICE_WIDTH_PRESETS, DEVICE_WIDTH_DEFAULT } from '../../device-config';
import { openIconPicker, renderIconTriggerPreview } from '../icon-picker';
import { iconDisplayName } from '../../icons';
import type { Device, DeviceType } from '../../types';
import { showModal, dismissModal } from './shared';

// ── Add / Edit Device ────────────────────────────────────────

export function showDeviceModal(device: Device | null, canvasX?: number, canvasY?: number, connectToId?: string): void {
  const isEdit = device !== null;
  const title = isEdit
    ? 'Edit Device'
    : (connectToId ? 'Add Connected Device' : 'Add Device');

  const typeOptions = DEVICE_TYPES.map(t =>
    `<option value="${t}"${device?.type === t ? ' selected' : ''}>${TYPE_LABELS[t]}</option>`
  ).join('');

  const state = getState();
  const map = getActiveMap(state);
  const hostOptions = map.devices
    .filter(d => d.id !== device?.id && d.type === 'server')
    .map(d => `<option value="${escapeHtml(d.id)}"${device?.hostId === d.id ? ' selected' : ''}>${escapeHtml(d.name)}</option>`)
    .join('');

  const modal = showModal(`
    <div class="modal-header">${title}</div>
    <div class="modal-body">
      <div class="form-row">
        <label>Name</label>
        <input type="text" id="modal-name" value="${escapeHtml(device?.name ?? '')}" placeholder="e.g. gateway" />
      </div>
      <div class="form-row">
        <label>Type</label>
        <select id="modal-type">${typeOptions}</select>
      </div>
      <div class="form-row-pair">
        <div class="form-row">
          <label>Icon</label>
          <button type="button" class="icon-picker-trigger" id="modal-icon-trigger">
            <span class="icon-preview" id="modal-icon-preview"></span>
            <span class="icon-trigger-label" id="modal-icon-label"></span>
            <span class="icon-trigger-hint">change</span>
          </button>
        </div>
        <div class="form-row">
          <label>Card Width</label>
          <div class="width-options" id="modal-width" role="radiogroup" aria-label="Card width">
            ${DEVICE_WIDTH_PRESETS.map((p, i) => {
              const selected = (device?.width ?? DEVICE_WIDTH_DEFAULT) === p.value;
              // Glyph width scales with the preset's relative size so the
              // visual cue matches what the card will look like on the canvas.
              const glyphPct = 30 + i * 25;
              return `
                <button type="button" class="width-option" role="radio"
                  data-value="${p.value}" aria-checked="${selected}"
                  title="${p.label}" aria-label="${p.label}">
                  <span class="width-glyph" style="width:${glyphPct}%"></span>
                </button>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="form-row-pair form-row-pair--ip-port">
        <div class="form-row">
          <label>IP Address</label>
          <input type="text" id="modal-ip" value="${escapeHtml(device?.ip ?? '')}" placeholder="192.168.1.1" />
        </div>
        <div class="form-row">
          <label>Port</label>
          <input type="number" id="modal-port" value="${device?.port ?? ''}" placeholder="—" />
        </div>
      </div>
      <div class="form-row">
        <label>Domain</label>
        <input type="text" id="modal-domain" value="${escapeHtml(device?.domain ?? '')}" placeholder="device.local" />
      </div>
      <div class="form-row">
        <label>MAC Address</label>
        <input type="text" id="modal-mac" value="${escapeHtml(device?.mac ?? '')}" placeholder="aa:bb:cc:dd:ee:ff" />
      </div>
      <div class="form-row" id="modal-host-row" style="display:none">
        <label>Host Machine</label>
        <select id="modal-host">
          <option value="">None</option>
          ${hostOptions}
        </select>
      </div>
      <div class="form-row">
        <label>Tags (comma-separated)</label>
        <input type="text" id="modal-tags" value="${escapeHtml(device?.tags.join(', ') ?? '')}" placeholder="core, server" />
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="modal-notes" rows="3" maxlength="${MAX_NOTES_LENGTH}" placeholder="Optional notes...">${escapeHtml(device?.notes ?? '')}</textarea>
        <span class="form-hint" id="modal-notes-count"></span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn secondary" id="modal-cancel">Cancel</button>
      <button class="modal-btn primary" id="modal-save">${isEdit ? 'Save' : 'Add Device'}</button>
    </div>
  `);

  // Show host field only for VM/Container type
  const typeSelect = q<HTMLSelectElement>(modal, '#modal-type');
  const hostSelect = q<HTMLSelectElement>(modal, '#modal-host');
  const hostRow = q<HTMLElement>(modal, '#modal-host-row');
  const updateHostVisibility = () => {
    hostRow.style.display = typeSelect.value === 'vm' ? '' : 'none';
    if (typeSelect.value !== 'vm') hostSelect.value = '';
  };
  typeSelect.addEventListener('change', updateHostVisibility);
  updateHostVisibility();

  // ── Notes counter ──────────────────────────────────────────
  const notesField = q<HTMLTextAreaElement>(modal, '#modal-notes');
  const notesCount = q<HTMLElement>(modal, '#modal-notes-count');
  const updateNotesCount = () => {
    notesCount.textContent = `${notesField.value.length} / ${MAX_NOTES_LENGTH}`;
  };
  updateNotesCount();
  notesField.addEventListener('input', updateNotesCount);

  // ── Icon picker ────────────────────────────────────────────
  let pickedIconId: string | undefined = device?.iconId;
  const iconPreview = q<HTMLElement>(modal, '#modal-icon-preview');
  const iconLabel = q<HTMLElement>(modal, '#modal-icon-label');
  const updateIconPreview = () => {
    const currentType = typeSelect.value as DeviceType;
    iconPreview.innerHTML = renderIconTriggerPreview(pickedIconId, currentType);
    iconLabel.textContent = iconDisplayName(pickedIconId, getState().customIcons) ?? 'Default for type';
  };
  updateIconPreview();
  // When type changes and the user is on the default icon, refresh preview emoji
  typeSelect.addEventListener('change', () => { if (!pickedIconId) updateIconPreview(); });
  q(modal, '#modal-icon-trigger').addEventListener('click', () => {
    openIconPicker({
      current: pickedIconId,
      fallbackType: typeSelect.value as DeviceType,
      onPick: (id) => {
        pickedIconId = id;
        updateIconPreview();
      },
    });
  });

  // Card width — segmented control behaves like a radio group
  const widthGroup = q<HTMLElement>(modal, '#modal-width');
  widthGroup.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.width-option');
    if (!btn) return;
    widthGroup.querySelectorAll<HTMLButtonElement>('.width-option').forEach(b => {
      b.setAttribute('aria-checked', String(b === btn));
    });
  });
  bindRadioGroupKeys(widthGroup, '.width-option');

  q(modal, '#modal-cancel').addEventListener('click', dismissModal);
  q(modal, '#modal-save').addEventListener('click', () => {
    const name = q<HTMLInputElement>(modal, '#modal-name').value.trim();
    if (!name) return;

    const type = typeSelect.value as DeviceType;
    const ip = q<HTMLInputElement>(modal, '#modal-ip').value.trim() || undefined;
    const portRaw = q<HTMLInputElement>(modal, '#modal-port').value;
    const port = portRaw ? parseInt(portRaw, 10) : undefined;
    const mac = q<HTMLInputElement>(modal, '#modal-mac').value.trim() || undefined;
    const domain = q<HTMLInputElement>(modal, '#modal-domain').value.trim() || undefined;
    const hostId = hostSelect.value || undefined;
    const tagsRaw = q<HTMLInputElement>(modal, '#modal-tags').value;
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    const notes = q<HTMLTextAreaElement>(modal, '#modal-notes').value.slice(0, MAX_NOTES_LENGTH);
    const checkedWidth = q<HTMLElement>(modal, '#modal-width').querySelector<HTMLButtonElement>('[aria-checked="true"]');
    const widthVal = checkedWidth ? parseInt(checkedWidth.dataset.value!, 10) : DEVICE_WIDTH_DEFAULT;
    const width = widthVal !== DEVICE_WIDTH_DEFAULT ? widthVal : undefined;

    const state = getState();
    const map = getActiveMap(state);

    if (isEdit && device) {
      const oldHostId = device.hostId;
      device.name = name;
      device.type = type;
      device.ip = ip;
      device.port = port;
      device.mac = mac;
      device.domain = domain;
      device.hostId = hostId;
      device.tags = tags;
      device.notes = notes;
      device.iconId = pickedIconId;
      device.width = width;
      map.updatedAt = new Date().toISOString();

      // Manage host link: remove old, add new (skipping if a link to the new
      // host already exists — manual connect-mode draws, prior duplicates, etc.
      // shouldn't pile up).
      if (oldHostId !== hostId) {
        if (oldHostId) {
          map.links = map.links.filter(l =>
            !((l.sourceId === device.id && l.targetId === oldHostId) ||
              (l.targetId === device.id && l.sourceId === oldHostId))
          );
        }
        if (hostId && !linkExists(map.links, device.id, hostId)) {
          map.links.push({
            id: generateId(),
            sourceId: device.id,
            targetId: hostId,
            type: 'wired',
          });
        }
      }
    } else {
      const explicitPosition = canvasX !== undefined && canvasY !== undefined;
      let newDevice: Device = {
        id: generateId(),
        name, type, ip, port, mac, domain, hostId, tags, notes,
        iconId: pickedIconId,
        width,
        x: canvasX ?? 0,
        y: canvasY ?? 0,
      };

      if (!explicitPosition) {
        [newDevice] = autoPosition([newDevice], map.devices);
      }

      map.devices.push(newDevice);

      // Auto-create link to host (skip if one already exists — shouldn't be
      // possible on a brand-new device, but defensive against future edge cases).
      if (hostId && !linkExists(map.links, newDevice.id, hostId)) {
        map.links.push({
          id: generateId(),
          sourceId: newDevice.id,
          targetId: hostId,
          type: 'wired',
        });
      }

      // Auto-create link to source device (when added via "Add Connected Device")
      if (connectToId && connectToId !== hostId && !linkExists(map.links, newDevice.id, connectToId)) {
        map.links.push({
          id: generateId(),
          sourceId: connectToId,
          targetId: newDevice.id,
          type: 'wired',
        });
      }

      map.updatedAt = new Date().toISOString();
    }

    setState(state);
    dismissModal();
  });

  // Focus name input
  nextFrame(() => q<HTMLInputElement>(modal, '#modal-name').focus());
}
