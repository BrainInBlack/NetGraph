import { Cable, Wifi } from 'lucide-static';
import { getState, setState } from '../../state';
import { getActiveMap } from '../../storage';
import { bindRadioGroupKeys, generateId, escapeHtml, nextFrame, q } from '../../util';
import type { Link, LinkType } from '../../types';
import { NAMED_PORTS } from '../../types';
import { showModal, dismissModal } from './shared';
import {
  parsePortInput,
  renderSidePicker,
  renderPortInput,
  bindSidePicker,
  bindPortInput,
} from './connection-fields';

// ── Type segmented control ───────────────────────────────────

const LINK_TYPE_OPTIONS: { value: LinkType; label: string; svg: string }[] = [
  { value: 'wired',    label: 'Wired',    svg: Cable },
  { value: 'wireless', label: 'Wireless', svg: Wifi  },
];

function renderTypeOptions(id: string, current: LinkType): string {
  return `
    <div class="type-options" id="${id}" role="radiogroup" aria-label="Connection type">
      ${LINK_TYPE_OPTIONS.map(opt => `
        <button type="button" class="type-option" role="radio"
          data-value="${opt.value}" aria-checked="${opt.value === current}"
          title="${opt.label}" aria-label="${opt.label}">
          <span class="type-glyph">${opt.svg}</span>
          <span class="type-option-label">${opt.label}</span>
        </button>
      `).join('')}
    </div>`;
}

function bindTypeOptions(modal: HTMLElement, id: string): () => LinkType {
  const group = q<HTMLElement>(modal, `#${id}`);
  group.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.type-option');
    if (!btn) return;
    group.querySelectorAll<HTMLButtonElement>('.type-option').forEach(b => {
      b.setAttribute('aria-checked', String(b === btn));
    });
  });
  bindRadioGroupKeys(group, '.type-option');
  return () => {
    const checked = group.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    return (checked?.dataset.value as LinkType) ?? 'wired';
  };
}

// ── Edit Connection ──────────────────────────────────────────

export function showEditConnectionModal(linkId: string): void {
  const state = getState();
  const map = getActiveMap(state);
  const link = map.links.find(l => l.id === linkId);
  if (!link) return;

  const source = map.devices.find(d => d.id === link.sourceId);
  const target = map.devices.find(d => d.id === link.targetId);
  if (!source || !target) return;

  // `source.type` / `target.type` are interpolated raw into the inline CSS
  // var below; safe because parseDevice (parse-shapes.ts) validates type
  // against the DEVICE_TYPES allow-list at ingest.
  const modal = showModal(`
    <div class="modal-header">Edit Connection</div>
    <div class="modal-body">
      <div class="conn-edit-endpoints">
        <div class="conn-edit-endpoint" style="--device-color: var(--c-${source.type})">
          <div class="conn-edit-endpoint-title">${escapeHtml(source.name)}</div>
          <div class="form-row">
            <label>Port</label>
            ${renderPortInput('modal-source-port', link.sourcePort)}
          </div>
          <div class="form-row">
            <label>Side</label>
            ${renderSidePicker('modal-source-side', link.sourceSide)}
          </div>
        </div>
        <div class="conn-edit-endpoint" style="--device-color: var(--c-${target.type})">
          <div class="conn-edit-endpoint-title">${escapeHtml(target.name)}</div>
          <div class="form-row">
            <label>Port</label>
            ${renderPortInput('modal-target-port', link.targetPort)}
          </div>
          <div class="form-row">
            <label>Side</label>
            ${renderSidePicker('modal-target-side', link.targetSide)}
          </div>
        </div>
      </div>
      <div class="form-row">
        <label>Label (optional)</label>
        <input type="text" id="modal-link-label" value="${escapeHtml(link.label ?? '')}" maxlength="50" placeholder="e.g. VLAN 10" />
      </div>
      <div class="form-row">
        <label>Type</label>
        ${renderTypeOptions('modal-link-type', link.type)}
      </div>
      <div id="modal-conn-error" class="form-error"></div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn secondary" id="modal-cancel">Cancel</button>
      <button class="modal-btn primary" id="modal-save">Save</button>
    </div>
  `);

  const getSourceSide = bindSidePicker(q(modal, '#modal-source-side'));
  const getTargetSide = bindSidePicker(q(modal, '#modal-target-side'));
  const getLinkType = bindTypeOptions(modal, 'modal-link-type');
  bindPortInput(modal, 'modal-source-port');
  bindPortInput(modal, 'modal-target-port');

  const errorEl = q(modal, '#modal-conn-error');
  nextFrame(() => q<HTMLInputElement>(modal, '#modal-source-port').focus());

  const submit = () => {
    const sourcePortInput = q<HTMLInputElement>(modal, '#modal-source-port').value;
    const targetPortInput = q<HTMLInputElement>(modal, '#modal-target-port').value;
    const sourcePort = parsePortInput(sourcePortInput);
    const targetPort = parsePortInput(targetPortInput);
    if (sourcePort === null || targetPort === null) {
      errorEl.textContent = 'Port must be empty, 1–256, or one of: ' + NAMED_PORTS.join(', ');
      return;
    }

    const type = getLinkType();
    const rawLabel = q<HTMLInputElement>(modal, '#modal-link-label').value.trim();
    const label = rawLabel ? rawLabel.slice(0, 50) : undefined;

    const state = getState();
    const map = getActiveMap(state);
    const l = map.links.find(x => x.id === linkId);
    if (l) {
      l.type = type;
      l.label = label;
      l.sourceSide = getSourceSide();
      l.targetSide = getTargetSide();
      l.sourcePort = sourcePort;
      l.targetPort = targetPort;
      map.updatedAt = new Date().toISOString();
      setState(state);
    }
    dismissModal();
  };

  q(modal, '#modal-cancel').addEventListener('click', dismissModal);
  q(modal, '#modal-save').addEventListener('click', submit);
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); dismissModal(); }
  });
}

// ── Add Connection ───────────────────────────────────────────

export function showConnectionModal(sourceDeviceId: string): void {
  const state = getState();
  const map = getActiveMap(state);
  const sourceDevice = map.devices.find(d => d.id === sourceDeviceId);
  if (!sourceDevice) return;

  const existingTargets = new Set(
    map.links
      .filter(l => l.sourceId === sourceDeviceId || l.targetId === sourceDeviceId)
      .map(l => l.sourceId === sourceDeviceId ? l.targetId : l.sourceId)
  );

  const availableDevices = map.devices.filter(d => d.id !== sourceDeviceId && !existingTargets.has(d.id));

  if (!availableDevices.length) {
    const modal = showModal(`
      <div class="modal-header">Add Connection</div>
      <div class="modal-body"><p>No available devices to connect to.</p></div>
      <div class="modal-footer">
        <button class="modal-btn secondary" id="modal-cancel">OK</button>
      </div>
    `);
    q(modal, '#modal-cancel').addEventListener('click', dismissModal);
    return;
  }

  // Drop the "(type)" hint — the legend's tint already conveys the device
  // type, so the dropdown can just show the bare name.
  //
  // `d.type` is interpolated raw into data-type / inline-style sites below
  // without escapeHtml; safe because `parseDevice` (parse-shapes.ts) validates
  // type against the DEVICE_TYPES allow-list at ingest, so anything that
  // reaches this point is one of a fixed set of CSS-safe identifier strings.
  const targetOptions = availableDevices.map(d =>
    `<option value="${escapeHtml(d.id)}" data-type="${d.type}">${escapeHtml(d.name)}</option>`
  ).join('');

  const initialTarget = availableDevices[0];

  const modal = showModal(`
    <div class="modal-header">Add Connection</div>
    <div class="modal-body">
      <div class="conn-edit-endpoints">
        <div class="conn-edit-endpoint" style="--device-color: var(--c-${sourceDevice.type})">
          <div class="conn-edit-endpoint-title">${escapeHtml(sourceDevice.name)}</div>
          <div class="form-row">
            <label>Port</label>
            ${renderPortInput('modal-source-port', undefined)}
          </div>
          <div class="form-row">
            <label>Side</label>
            ${renderSidePicker('modal-source-side', undefined)}
          </div>
        </div>
        <div class="conn-edit-endpoint" id="modal-target-endpoint"
          style="--device-color: var(--c-${initialTarget.type})">
          <div class="conn-edit-endpoint-title">
            <select id="modal-target" class="legend-select" aria-label="Target device">${targetOptions}</select>
          </div>
          <div class="form-row">
            <label>Port</label>
            ${renderPortInput('modal-target-port', undefined)}
          </div>
          <div class="form-row">
            <label>Side</label>
            ${renderSidePicker('modal-target-side', undefined)}
          </div>
        </div>
      </div>
      <div class="form-row">
        <label>Type</label>
        ${renderTypeOptions('modal-link-type', 'wired')}
      </div>
      <div id="modal-conn-error" class="form-error"></div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn secondary" id="modal-cancel">Cancel</button>
      <button class="modal-btn primary" id="modal-save">Connect</button>
    </div>
  `);

  bindPortInput(modal, 'modal-source-port');
  bindPortInput(modal, 'modal-target-port');
  const getSourceSide = bindSidePicker(q(modal, '#modal-source-side'));
  const getTargetSide = bindSidePicker(q(modal, '#modal-target-side'));
  const getLinkType = bindTypeOptions(modal, 'modal-link-type');
  const errorEl = q(modal, '#modal-conn-error');

  // The target device picker IS the fieldset legend, so changing it only
  // needs to re-tint the surrounding fieldset — the legend text takes care of
  // itself.
  const targetSelect = q<HTMLSelectElement>(modal, '#modal-target');
  const targetFieldset = q<HTMLElement>(modal, '#modal-target-endpoint');
  targetSelect.addEventListener('change', () => {
    const type = targetSelect.selectedOptions[0]?.dataset.type;
    // Skip the property update if dataset.type is somehow missing — setting
    // `var(--c-)` would be invalid CSS and rely on the fallback chain.
    if (type) targetFieldset.style.setProperty('--device-color', `var(--c-${type})`);
  });

  q(modal, '#modal-cancel').addEventListener('click', dismissModal);
  q(modal, '#modal-save').addEventListener('click', () => {
    const targetId = targetSelect.value;
    const type = getLinkType();
    const sourcePort = parsePortInput(q<HTMLInputElement>(modal, '#modal-source-port').value);
    const targetPort = parsePortInput(q<HTMLInputElement>(modal, '#modal-target-port').value);
    if (sourcePort === null || targetPort === null) {
      errorEl.textContent = 'Port must be empty, 1–256, or one of: ' + NAMED_PORTS.join(', ');
      return;
    }

    const state = getState();
    const map = getActiveMap(state);

    const link: Link = {
      id: generateId(),
      sourceId: sourceDeviceId,
      targetId,
      type,
      sourcePort,
      targetPort,
      sourceSide: getSourceSide(),
      targetSide: getTargetSide(),
    };

    map.links.push(link);
    map.updatedAt = new Date().toISOString();
    setState(state);
    dismissModal();
  });
}
