import { scheduleRender, onDeviceDragEnd, onDeviceClick, onDeviceContextMenu, getState } from '../../state';
import { getActiveMap } from '../../storage';
import type { Device, NetworkMap } from '../../types';
import { getZoom } from '../../ui/zoom';
import { DEVICE_ICONS, DEVICE_TYPES, TYPE_LABELS, DEVICE_WIDTH_DEFAULT } from '../../device-config';
import { renderIconHtml } from '../../icons';
import { snapToGrid, escapeHtml, createLongPress } from '../../util';
// Deliberate layering exception: the renderer is otherwise a leaf consumer
// of state, but the device drag handler needs to know whether a drag should
// move just this device or the whole multi-selection — and that knowledge
// lives in select-mode. The alternative (renderer fires drag events, select-
// mode listens and mutates) would force the renderer to either skip its own
// per-device drag math or duplicate it across two paths. Keeping the import
// is the simpler trade.
import { beginGroupDrag, applyGroupDrag, endGroupDrag, type GroupDragSnapshot } from '../../ui/select-mode';

// ── Device cards ─────────────────────────────────────────────

export function renderDevices(
  devices: Device[],
  selectedId: string | null,
  selectedIds: Set<string>,
  map: NetworkMap,
): void {
  const layer = document.getElementById('device-layer')!;

  // Index existing device cards by id in a single pass, then reuse the map for
  // both the removal sweep and the per-device lookup below. Avoids an O(n)
  // querySelector per device (which made the whole render O(n²)) — mirrors the
  // same index pattern in renderConnections.
  const existing = new Map<string, HTMLElement>();
  layer.querySelectorAll<HTMLElement>('.device').forEach(el => {
    const id = el.dataset.deviceId;
    if (id) existing.set(id, el);
  });

  // Remove devices no longer in the map
  const deviceIds = new Set(devices.map(d => d.id));
  for (const [id, el] of existing) {
    if (!deviceIds.has(id)) el.remove();
  }

  for (const device of devices) {
    let el = existing.get(device.id);
    if (!el) {
      el = createDeviceElement(device, map);
      layer.appendChild(el);
      attachDeviceDragHandlers(el, device.id);
    } else {
      // Only rewrite innerHTML when content-relevant fields have actually changed.
      // Position is handled separately via style.left/top, so a drag (which fires
      // render() at 60fps) does not trigger any innerHTML churn here.
      const hash = deviceContentHash(device, map);
      if (el.dataset.contentHash !== hash) {
        updateDeviceElement(el, device, map);
        el.dataset.contentHash = hash;
      }
    }

    // The drag handler writes device.x/y on every pointermove, so the model is
    // always authoritative — apply unconditionally.
    el.style.left = `${device.x}px`;
    el.style.top = `${device.y}px`;
    el.style.width = device.width ? `${device.width}px` : '';
    el.classList.toggle('selected', device.id === selectedId);
    el.classList.toggle('multi-selected', selectedIds.has(device.id));
    // Wider-than-default cards flip to a side-by-side layout via the `wide` class
    el.classList.toggle('wide', (device.width ?? DEVICE_WIDTH_DEFAULT) > DEVICE_WIDTH_DEFAULT);
  }
}

/** Compact serialization of every field that affects the rendered card markup. */
function deviceContentHash(device: Device, map: NetworkMap): string {
  const host = device.hostId ? map.devices.find(d => d.id === device.hostId) : undefined;
  // Tuple — order matters but is stable
  return JSON.stringify([
    device.type,
    device.name,
    device.ip ?? '',
    device.port ?? '',
    device.mac ?? '',
    device.domain ?? '',
    device.iconId ?? '',
    device.tags,
    host ? [host.type, host.name] : null,
  ]);
}

function createDeviceElement(device: Device, map: NetworkMap): HTMLElement {
  const el = document.createElement('div');
  el.className = `device ${device.type}`;
  el.dataset.deviceId = device.id;
  updateDeviceElement(el, device, map);
  el.dataset.contentHash = deviceContentHash(device, map);
  return el;
}

function updateDeviceElement(el: HTMLElement, device: Device, map: NetworkMap): void {
  // Update the type class without disturbing dynamic state classes
  // (`selected`, `dragging`, `conn-highlight`) that are managed elsewhere.
  for (const t of DEVICE_TYPES) el.classList.remove(t);
  el.classList.add(device.type);

  const host = device.hostId ? map.devices.find(d => d.id === device.hostId) : undefined;
  const typeRow = host
    ? `<div class="device-host"><span class="device-host-dot" style="background:var(--c-${host.type})"></span>on ${escapeHtml(host.name)}</div>`
    : `<div class="device-type">${TYPE_LABELS[device.type]}</div>`;

  const metaRows: string[] = [];
  if (device.ip) {
    let addr = `<span class="device-ip">${escapeHtml(device.ip)}</span>`;
    if (device.port) addr += `<span class="device-port">:${device.port}</span>`;
    metaRows.push(`<div class="device-addr">${addr}</div>`);
  }
  if (device.domain) {
    metaRows.push(`<div class="device-domain">${escapeHtml(device.domain)}</div>`);
  }
  const metaSection = metaRows.length
    ? `<div class="device-meta">${metaRows.join('')}</div>`
    : '';

  const footer = device.tags.length
    ? `<div class="device-footer"><div class="device-tags">${
        device.tags.map(t => `<span class="dtag">#${escapeHtml(t)}</span>`).join('')
      }</div></div>`
    : '';

  const iconHtml = device.iconId
    ? renderIconHtml(device.iconId, getState().customIcons)
    : DEVICE_ICONS[device.type];

  el.innerHTML = `
    <div class="device-header">
      <div class="device-icon">${iconHtml}</div>
      <div class="device-info">
        <div class="device-name">${escapeHtml(device.name)}</div>
        ${typeRow}
      </div>
    </div>
    ${metaSection}
    ${footer}`;
}

// ── Drag handling ────────────────────────────────────────────

// Touch pointers wobble more than a mouse, so we need a slightly looser
// threshold or quick taps register as accidental drags.
const DRAG_THRESHOLD_MOUSE = 3;
const DRAG_THRESHOLD_TOUCH = 8;

function attachDeviceDragHandlers(el: HTMLElement, deviceId: string): void {
  let dragging = false;
  let pointerDown = false;
  let activePointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;
  let threshold = DRAG_THRESHOLD_MOUSE;
  // The dragged device's live model object, captured at pointerdown. Its
  // identity is stable for the duration of a drag (state is mutated in place,
  // never replaced), so we reuse the reference each frame instead of an O(n)
  // `find` on every pointermove.
  let device: Device | null = null;
  // When the dragged device is part of a multi-selection, the whole group
  // moves together. `groupDrag` captures every selected device's origin at
  // pointerdown; null means single-device drag (the default).
  let groupDrag: GroupDragSnapshot | null = null;
  const longPress = createLongPress();

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pointerDown = true;
    dragging = false;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    threshold = e.pointerType === 'touch' ? DRAG_THRESHOLD_TOUCH : DRAG_THRESHOLD_MOUSE;

    // Look up the live device from the model once; reused for the rest of the drag
    const map = getActiveMap(getState());
    device = map.devices.find(d => d.id === deviceId) ?? null;
    if (!device) return;
    origX = device.x;
    origY = device.y;
    // Probe select-mode for a group-drag snapshot; null = single drag
    groupDrag = beginGroupDrag(deviceId);

    // On touch, long-press substitutes for right-click → device context menu
    longPress.start(e, () => {
      pointerDown = false;
      onDeviceContextMenu(deviceId, e.clientX, e.clientY);
    });
  });

  el.addEventListener('pointermove', (e) => {
    if (!pointerDown || e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!dragging && (Math.abs(dx) > threshold || Math.abs(dy) > threshold)) {
      dragging = true;
      longPress.cancel(); // a real drag means no context menu
      el.classList.add('dragging');
      el.setPointerCapture(e.pointerId);
    }
    longPress.move(e);
    if (dragging && device) {
      const zoom = getZoom();
      const cdx = dx / zoom;
      const cdy = dy / zoom;
      if (groupDrag) {
        applyGroupDrag(groupDrag, cdx, cdy);
      } else {
        device.x = snapToGrid(origX + cdx);
        device.y = snapToGrid(origY + cdy);
      }
      scheduleRender();
    }
  });

  const endDrag = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    pointerDown = false;
    activePointerId = null;
    longPress.cancel();
    if (dragging && device) {
      el.classList.remove('dragging');
      if (groupDrag) {
        endGroupDrag();
      } else {
        onDeviceDragEnd(deviceId, device.x, device.y);
      }
    }
    groupDrag = null;
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  el.addEventListener('click', (e) => {
    if (dragging) {
      // Suppress the synthesized click that follows a drag
      e.stopPropagation();
      dragging = false;
      return;
    }
    e.stopPropagation();
    onDeviceClick(deviceId, e.clientX, e.clientY);
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onDeviceContextMenu(deviceId, e.clientX, e.clientY);
  });
}
