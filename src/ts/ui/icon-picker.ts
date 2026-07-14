import { getState, setState } from '../state';
import { ICON_LIBRARY, renderIconHtml } from '../icons';
import { DEVICE_ICONS } from '../device-config';
import { bindOverlayDismiss, escapeHtml, pushModalLock, popModalLock, ensureStackedOverlay, Z_ICON_PICKER_OVERLAY, trapFocus } from '../util';
import { confirmDeleteCustomIcon } from './icon-manager';
import { readFileAsIcon, IMAGE_MAX_BYTES, IMAGE_MAX_DIMENSION, MAX_SVG_LENGTH } from './icon-upload';
import type { DeviceType } from '../types';

interface OpenOptions {
  /** Currently selected iconId (lucide:* / custom:*), or undefined for the type default. */
  current?: string;
  /** Used to render the "default" tile preview. */
  fallbackType: DeviceType;
  /** Called with the new iconId (or undefined to clear). */
  onPick: (iconId: string | undefined) => void;
}

let activeOptions: OpenOptions | null = null;
let backdropBound = false;
let releaseTrap: (() => void) | null = null;

export function openIconPicker(opts: OpenOptions): void {
  if (activeOptions) return; // already open - ignore re-entrance
  activeOptions = opts;
  const overlay = ensureOverlay();
  // Backdrop click handler is bound exactly once. bindEvents() runs after
  // every delete and re-render, so duplicating it there would leak listeners.
  if (!backdropBound) {
    bindOverlayDismiss(overlay, closeIconPicker);
    backdropBound = true;
  }
  overlay.innerHTML = renderModal();
  overlay.style.display = 'flex';
  pushModalLock();
  bindEvents(overlay);
  releaseTrap = trapFocus(overlay);
}

function closeIconPicker(): void {
  const overlay = document.getElementById('icon-picker-overlay');
  if (!overlay || !activeOptions) return;
  overlay.style.display = 'none';
  overlay.innerHTML = '';
  releaseTrap?.();
  releaseTrap = null;
  popModalLock();
  activeOptions = null;
}

/**
 * The icon picker uses its own overlay (separate from #modal-overlay) so it can
 * stack on top of the Edit Device modal without clobbering it.
 */
function ensureOverlay(): HTMLElement {
  return ensureStackedOverlay('icon-picker-overlay', Z_ICON_PICKER_OVERLAY);
}

function renderModal(): string {
  if (!activeOptions) return '';
  const { current, fallbackType } = activeOptions;
  const customIcons = getState().customIcons ?? [];

  const groupedLibrary = groupBy(ICON_LIBRARY, i => i.category);
  const libraryHtml = [...groupedLibrary.entries()].map(([category, items]) => `
    <div class="icon-picker-category">${escapeHtml(category)}</div>
    <div class="icon-picker-grid">
      ${items.map(i => `
        <div class="icon-tile${current === i.id ? ' selected' : ''}" data-icon-id="${i.id}" title="${escapeHtml(i.name)}">
          ${i.svg}
        </div>
      `).join('')}
    </div>
  `).join('');

  const customHtml = customIcons.length
    ? `<div class="icon-picker-grid">
         ${customIcons.map(c => `
           <div class="icon-tile${current === `custom:${c.id}` ? ' selected' : ''}" data-icon-id="custom:${escapeHtml(c.id)}" title="${escapeHtml(c.name)}">
             ${c.kind === 'svg' ? c.data : `<img src="${escapeHtml(c.data)}" alt="${escapeHtml(c.name)}" />`}
             <button class="icon-tile-delete" data-delete-custom="${escapeHtml(c.id)}" title="Delete">✕</button>
           </div>
         `).join('')}
       </div>`
    : '<div class="icon-picker-empty">No custom icons yet</div>';

  return `
    <div class="modal icon-picker" role="dialog" aria-modal="true" aria-label="Choose Icon">
      <div class="modal-header">Choose Icon</div>
      <div class="icon-picker-tabs">
        <button class="icon-picker-tab active" data-tab="library">Library</button>
        <button class="icon-picker-tab" data-tab="custom">Custom</button>
      </div>
      <div class="icon-picker-pane" data-pane="library">
        <div class="icon-picker-grid" style="margin-bottom:14px;">
          <div class="icon-tile is-default${!current ? ' selected' : ''}" data-icon-id="" title="Use default for type">
            ${DEVICE_ICONS[fallbackType]}
          </div>
        </div>
        ${libraryHtml}
      </div>
      <div class="icon-picker-pane hidden" data-pane="custom">
        ${customHtml}
        <div class="icon-picker-upload">
          <label class="upload-btn">
            Upload SVG / PNG / JPG
            <input type="file" accept=".svg,image/svg+xml,image/png,image/jpeg" />
          </label>
          <span class="upload-hint">SVG up to ${MAX_SVG_LENGTH / 1024} KB (inherits theme color) · PNG/JPG up to ${IMAGE_MAX_BYTES / 1024} KB (downscaled to ${IMAGE_MAX_DIMENSION}px)</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn secondary" id="icon-picker-cancel">Close</button>
      </div>
    </div>
  `;
}

function bindEvents(overlay: HTMLElement): void {
  overlay.querySelector('#icon-picker-cancel')?.addEventListener('click', closeIconPicker);

  // Tab switching
  overlay.querySelectorAll<HTMLElement>('.icon-picker-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab!;
      overlay.querySelectorAll('.icon-picker-tab').forEach(t => t.classList.toggle('active', t === tab));
      overlay.querySelectorAll<HTMLElement>('.icon-picker-pane').forEach(p => {
        p.classList.toggle('hidden', p.dataset.pane !== target);
      });
    });
  });

  // Tile selection
  overlay.querySelectorAll<HTMLElement>('.icon-tile').forEach(tile => {
    tile.addEventListener('click', (e) => {
      // Ignore clicks on the per-tile delete button
      if ((e.target as HTMLElement).closest('[data-delete-custom]')) return;
      const id = tile.dataset.iconId ?? '';
      activeOptions?.onPick(id || undefined);
      closeIconPicker();
    });
  });

  overlay.querySelectorAll<HTMLElement>('[data-delete-custom]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteCustom!;
      // If the device modal currently has this icon picked, the next open of
      // its picker will show "default for type" instead.
      if (activeOptions?.current === `custom:${id}`) {
        activeOptions.onPick(undefined);
      }
      if (!confirmDeleteCustomIcon(id)) return;
      overlay.innerHTML = renderModal();
      bindEvents(overlay);
      // Stay on the custom tab after the re-render
      overlay.querySelectorAll<HTMLElement>('.icon-picker-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'custom'));
      overlay.querySelectorAll<HTMLElement>('.icon-picker-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== 'custom'));
    });
  });

  // Upload
  const fileInput = overlay.querySelector<HTMLInputElement>('.icon-picker-upload input[type="file"]');
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const icon = await readFileAsIcon(file);
      const state = getState();
      state.customIcons = [...(state.customIcons ?? []), icon];
      setState(state);
      // Auto-select the newly added icon and close
      activeOptions?.onPick(`custom:${icon.id}`);
      closeIconPicker();
    } catch (err) {
      alert((err as Error).message);
      fileInput.value = '';
    }
  });
}

function groupBy<T, K>(arr: T[], keyFn: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of arr) {
    const k = keyFn(item);
    const list = m.get(k) ?? [];
    list.push(item);
    m.set(k, list);
  }
  return m;
}

// Re-export helper so modals.ts can render the trigger preview consistently
export function renderIconTriggerPreview(iconId: string | undefined, fallbackType: DeviceType): string {
  if (!iconId) return DEVICE_ICONS[fallbackType];
  return renderIconHtml(iconId, getState().customIcons);
}
