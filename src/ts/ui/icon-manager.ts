import { getState, setState } from '../state';
import { renderIconHtml } from '../icons';
import { bindOverlayDismiss, escapeHtml, q, pushModalLock, popModalLock, ensureStackedOverlay, Z_STACKED_OVERLAY, trapFocus } from '../util';
import { readFileAsIcon, IMAGE_MAX_BYTES, IMAGE_MAX_DIMENSION, MAX_SVG_LENGTH } from './icon-upload';
import type { CustomIcon } from '../types';

/**
 * Standalone "Manage Icons" view. Mirrors the icon picker's Custom tab -
 * tile grid of every custom icon plus the same upload affordance - so the
 * user can manage their library without going through a device's icon
 * picker. The per-tile delete button and the upload behavior are shared
 * with the picker (via icon-upload.ts).
 */
let backdropBound = false;
let releaseTrap: (() => void) | null = null;

export function openIconManager(): void {
  const overlay = ensureOverlay();
  // Bind the backdrop-click handler exactly once - render() runs after every
  // delete/upload and would otherwise stack a fresh listener each time.
  if (!backdropBound) {
    bindOverlayDismiss(overlay, () => close(overlay));
    backdropBound = true;
  }
  render(overlay);
  overlay.style.display = 'flex';
  pushModalLock();
  releaseTrap = trapFocus(overlay);
}

function close(overlay: HTMLElement): void {
  overlay.style.display = 'none';
  overlay.innerHTML = '';
  releaseTrap?.();
  releaseTrap = null;
  popModalLock();
}

function render(overlay: HTMLElement): void {
  const state = getState();
  const icons = state.customIcons ?? [];
  const usage = computeUsageCounts();

  const sortedIcons = [...icons].sort((a, b) => a.name.localeCompare(b.name));

  const tilesHtml = sortedIcons.length
    ? `<div class="icon-picker-grid">
         ${sortedIcons.map(c => renderTile(c, usage.get(c.id) ?? 0, icons)).join('')}
       </div>`
    : '<div class="icon-picker-empty">No custom icons yet - upload one below.</div>';

  overlay.innerHTML = `
    <div class="modal icon-manager" role="dialog" aria-modal="true" aria-label="Manage Icons">
      <div class="modal-header">Manage Icons</div>
      <div class="modal-body">
        ${tilesHtml}
        <div class="icon-picker-upload">
          <label class="upload-btn">
            Upload SVG / PNG / JPG
            <input type="file" accept=".svg,image/svg+xml,image/png,image/jpeg" />
          </label>
          <span class="upload-hint">SVG up to ${MAX_SVG_LENGTH / 1024} KB (inherits theme color) · PNG/JPG up to ${IMAGE_MAX_BYTES / 1024} KB (downscaled to ${IMAGE_MAX_DIMENSION}px)</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn secondary" id="icon-manager-close">Close</button>
      </div>
    </div>
  `;

  q(overlay, '#icon-manager-close').addEventListener('click', () => close(overlay));

  overlay.querySelectorAll<HTMLElement>('[data-delete-icon]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirmDeleteCustomIcon(btn.dataset.deleteIcon!)) render(overlay);
    });
  });

  const fileInput = overlay.querySelector<HTMLInputElement>('.icon-picker-upload input[type="file"]');
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const icon = await readFileAsIcon(file);
      const s = getState();
      s.customIcons = [...(s.customIcons ?? []), icon];
      setState(s);
      render(overlay);
    } catch (err) {
      alert((err as Error).message);
      fileInput.value = '';
    }
  });
}

function renderTile(icon: CustomIcon, count: number, customIcons: CustomIcon[]): string {
  const preview = renderIconHtml(`custom:${icon.id}`, customIcons);
  const kindLabel = icon.kind === 'svg' ? 'SVG' : 'Image';
  const usageLabel = count === 0 ? 'unused' : `${count} device${count === 1 ? '' : 's'}`;
  const title = `${icon.name} - ${kindLabel} · ${usageLabel}`;
  return `
    <div class="icon-tile" title="${escapeHtml(title)}">
      ${preview}
      <button class="icon-tile-delete" data-delete-icon="${escapeHtml(icon.id)}" aria-label="Delete ${escapeHtml(icon.name)}">✕</button>
    </div>
  `;
}

/** Tally device.iconId references per custom icon ID across all maps. */
function computeUsageCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const map of getState().maps) {
    for (const d of map.devices) {
      if (!d.iconId?.startsWith('custom:')) continue;
      const id = d.iconId.slice('custom:'.length);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Delete a custom icon and clear any `device.iconId` references to it. The
 * affected devices fall back to their type's default emoji on next render.
 */
export function deleteIcon(id: string): void {
  const state = getState();
  state.customIcons = (state.customIcons ?? []).filter(c => c.id !== id);
  const ref = `custom:${id}`;
  for (const map of state.maps) {
    let touched = false;
    for (const d of map.devices) {
      if (d.iconId === ref) { d.iconId = undefined; touched = true; }
    }
    if (touched) map.updatedAt = new Date().toISOString();
  }
  setState(state);
}

/**
 * Show a confirm dialog with the icon's usage count, then delete on OK.
 * Returns true if the icon was actually deleted. Used by both the picker's
 * per-tile ✕ and the manager's per-tile ✕ so the wording stays in one place.
 */
export function confirmDeleteCustomIcon(id: string): boolean {
  const icon = (getState().customIcons ?? []).find(c => c.id === id);
  if (!icon) return false;
  const count = computeUsageCounts().get(id) ?? 0;
  const usageMsg = count
    ? `It's used by ${count} device${count === 1 ? '' : 's'} - they'll fall back to the default icon for their type.`
    : 'No devices currently use this icon.';
  if (!confirm(`Delete "${icon.name}"?\n\n${usageMsg}`)) return false;
  deleteIcon(id);
  return true;
}

function ensureOverlay(): HTMLElement {
  return ensureStackedOverlay('icon-manager-overlay', Z_STACKED_OVERLAY);
}
