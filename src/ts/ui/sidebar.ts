import { setSelectedDeviceId, getState, onDeviceClick } from '../state';
import { DEVICE_ICONS, TYPE_LABELS } from '../device-config';
import { renderIconHtml } from '../icons';
import { escapeHtml } from '../util';
import type { Device, NetworkMap } from '../types';

export function initSidebar(): void {
  document.getElementById('panel-close-btn')!.addEventListener('click', (e) => {
    e.stopPropagation();
    closePanel();
    setSelectedDeviceId(null);
  });
}

/**
 * Hash of every field the panel actually displays. Excludes position so a
 * device drag — which fires `render()` (and therefore `openPanel`) at 60+/s
 * via the after-render hook — doesn't trigger a full innerHTML rewrite when
 * nothing visible changed.
 */
function panelContentHash(device: Device, map: NetworkMap): string {
  const isVm = device.type === 'vm';
  let connSnapshot: unknown;
  if (isVm) {
    const host = device.hostId ? map.devices.find(d => d.id === device.hostId) : null;
    connSnapshot = host ? [host.type, host.name] : null;
  } else {
    // Build a single id→device lookup so we avoid an O(devices) find() per link
    const byId = new Map(map.devices.map(d => [d.id, d]));
    connSnapshot = map.links
      .filter(l => l.sourceId === device.id || l.targetId === device.id)
      .map(l => {
        const otherId = l.sourceId === device.id ? l.targetId : l.sourceId;
        const other = byId.get(otherId);
        // This device's port is what the list actually surfaces (falling back to
        // label), so it must be in the hash — otherwise editing a port leaves the
        // open panel stale because the hash short-circuits the rewrite.
        const myPort = l.sourceId === device.id ? l.sourcePort : l.targetPort;
        return [l.id, l.type, l.label ?? '', myPort ?? '', other?.name ?? '', other?.type ?? ''];
      });
  }
  return JSON.stringify([
    device.id,             // include id so switching device forces a re-render
    device.type,
    device.name,
    device.ip ?? '',
    device.port ?? '',
    device.domain ?? '',
    device.mac ?? '',
    device.iconId ?? '',
    device.tags,
    device.notes,
    connSnapshot,
  ]);
}

let lastPanelHash: string | null = null;

export function openPanel(device: Device, map: NetworkMap): void {
  const panel = document.getElementById('detail-panel')!;
  // Short-circuit when the panel is already showing this exact content.
  // Crucially: this is what stops 60fps churn when the user drags a selected
  // device — position changes but the panel data doesn't.
  const hash = panelContentHash(device, map);
  if (lastPanelHash === hash && !panel.classList.contains('hidden')) return;
  lastPanelHash = hash;

  const iconEl = document.getElementById('panel-icon')!;
  const titleEl = document.getElementById('panel-title')!;
  const subtitleEl = document.getElementById('panel-subtitle')!;
  const bodyEl = document.getElementById('panel-body')!;
  const actionsEl = document.getElementById('panel-actions')!;

  iconEl.innerHTML = device.iconId
    ? renderIconHtml(device.iconId, getState().customIcons)
    : DEVICE_ICONS[device.type];
  iconEl.style.borderColor = `var(--c-${device.type})`;
  titleEl.textContent = device.name;
  subtitleEl.textContent = TYPE_LABELS[device.type];

  // Identity section
  const identityRows: string[] = [];
  if (device.ip) {
    let addr = `<span style="color:var(--c-${device.type})">${escapeHtml(device.ip)}</span>`;
    if (device.port) addr += `<span style="color:var(--text-dim)">:${device.port}</span>`;
    identityRows.push(propRow('IP Address', addr));
  }
  if (device.domain) identityRows.push(propRow('Domain', escapeHtml(device.domain)));
  if (device.mac)    identityRows.push(propRow('MAC', `<span style="font-size:12px">${escapeHtml(device.mac)}</span>`));

  // Tags
  const tagsHtml = device.tags.length
    ? device.tags.map(t => `<span class="panel-tag">#${escapeHtml(t)}</span>`).join('')
    : '<span class="empty-hint">No tags</span>';

  // Connections / Host — VMs only show their host; everything else shows network links
  const isVm = device.type === 'vm';
  const host = isVm && device.hostId ? map.devices.find(d => d.id === device.hostId) : null;

  const connHtml = isVm
    ? (host
        ? `<div class="conn-item" data-device-id="${escapeHtml(host.id)}">
             <div class="conn-item-dot" style="background:var(--c-${host.type})"></div>
             <div class="conn-item-name">${escapeHtml(host.name)}</div>
             <div class="conn-item-type">host</div>
           </div>`
        : '<div class="empty-hint">No host assigned</div>')
    : renderConnectionList(device, map);

  const connSectionLabel = isVm ? 'Host' : 'Connections';

  const notesHtml = device.notes
    ? `<div class="notes-text">${escapeHtml(device.notes)}</div>`
    : '<div class="empty-hint">No notes</div>';

  bodyEl.innerHTML = `
    <div class="prop-group">
      <div class="prop-group-label">Identity</div>
      ${identityRows.join('')}
    </div>
    <div class="prop-group">
      <div class="prop-group-label">Tags</div>
      <div class="panel-tags">${tagsHtml}</div>
    </div>
    <div class="prop-group">
      <div class="prop-group-label">${connSectionLabel}</div>
      <div class="connections-list">${connHtml}</div>
    </div>
    <div class="prop-group">
      <div class="prop-group-label">Notes</div>
      ${notesHtml}
    </div>`;

  actionsEl.innerHTML = `
    <button class="panel-action-btn" data-action="edit"><span class="panel-action-icon">✎</span>Edit Device</button>
    <button class="panel-action-btn" data-action="connect"><span class="panel-action-icon">⇄</span>Add Connection</button>
    <button class="panel-action-btn danger" data-action="delete"><span class="panel-action-icon">✕</span>Delete Device</button>
  `;

  actionsEl.querySelector('[data-action="edit"]')!.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('netgraph:edit-device', { detail: { deviceId: device.id } }));
  });
  actionsEl.querySelector('[data-action="connect"]')!.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('netgraph:add-connection', { detail: { deviceId: device.id } }));
  });
  actionsEl.querySelector('[data-action="delete"]')!.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('netgraph:delete-device', { detail: { deviceId: device.id } }));
  });

  // Click connection item → select that device
  bodyEl.querySelectorAll('.conn-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('conn-item-delete')) return;
      const id = (item as HTMLElement).dataset.deviceId!;
      const me = e as MouseEvent;
      onDeviceClick(id, me.clientX, me.clientY);
    });
  });

  // Delete connection → dispatch shared event (handled in modals.ts)
  bodyEl.querySelectorAll('.conn-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const linkId = (btn as HTMLElement).dataset.linkId!;
      document.dispatchEvent(new CustomEvent('netgraph:delete-connection', { detail: { linkId } }));
    });
  });

  panel.classList.remove('hidden');
}

export function closePanel(): void {
  document.getElementById('detail-panel')!.classList.add('hidden');
  // Force a full re-render the next time the panel opens, even if it's the
  // same device — otherwise the short-circuit in openPanel would no-op and
  // the panel would stay hidden.
  lastPanelHash = null;
}

function renderConnectionList(device: Device, map: NetworkMap): string {
  const links = map.links.filter(l => l.sourceId === device.id || l.targetId === device.id);
  if (!links.length) return '<div class="empty-hint">No connections</div>';

  return links.map(l => {
    const otherId = l.sourceId === device.id ? l.targetId : l.sourceId;
    const other = map.devices.find(d => d.id === otherId);
    if (!other) return '';
    // Show this device's port if set; fall back to the link label. The
    // connection line itself uses `label` (rendered at the bend leg by the
    // renderer); the panel surfaces port info because that's what you want
    // to see when reading a device's wiring.
    const myPort = l.sourceId === device.id ? l.sourcePort : l.targetPort;
    const detail = myPort !== undefined ? String(myPort) : l.label;
    const suffix = detail ? ` · ${escapeHtml(detail)}` : '';
    return `
      <div class="conn-item" data-device-id="${escapeHtml(other.id)}" data-link-id="${escapeHtml(l.id)}">
        <div class="conn-item-dot" style="background:var(--c-${other.type})"></div>
        <div class="conn-item-name">${escapeHtml(other.name)}</div>
        <div class="conn-item-type">${l.type}${suffix}</div>
        <button class="conn-item-delete" data-link-id="${escapeHtml(l.id)}" title="Remove connection">✕</button>
      </div>`;
  }).join('');
}

function propRow(key: string, value: string): string {
  return `<div class="prop-row"><span class="prop-key">${key}</span><span class="prop-val">${value}</span></div>`;
}
