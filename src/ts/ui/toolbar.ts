import { getState, setState, setSelectedDeviceId } from '../state';
import { getActiveMap } from '../storage';
import { escapeHtml } from '../util';
import { exportMap, exportBundle, downloadJson } from '../import-export';
import { pickAndImport } from './import-modal';
import { closePanel } from './sidebar';

export function initToolbar(): void {
  const btn = document.getElementById('map-selector-btn')!;
  const dropdown = document.getElementById('map-dropdown')!;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden', open);
    btn.classList.toggle('open', !open);
    // Opening the toolbar dropdown is a "leave the current device" gesture -
    // close the detail panel and clear selection so the user isn't left with
    // a stale panel hovering next to an unrelated menu.
    if (!open) {
      closePanel();
      setSelectedDeviceId(null);
    }
  });

  // Bundle export confirmation - fired by the filename modal in modals.ts
  document.addEventListener('netgraph:export-bundle-confirmed', ((e: CustomEvent) => {
    const filename = e.detail?.filename ?? 'netgraph-backup';
    downloadJson(filename, exportBundle(getState()));
  }) as EventListener);

  renderDropdown();
}

export function renderDropdown(): void {
  const state = getState();
  const dropdown = document.getElementById('map-dropdown')!;
  const btn = document.getElementById('map-selector-btn')!;
  const activeMap = getActiveMap(state);

  btn.querySelector('.map-selector-label')!.textContent = activeMap.name;

  const canDelete = state.maps.length > 1;
  const mapOptions = state.maps.map(m => `
    <div class="map-option${m.id === state.activeMapId ? ' active' : ''}" data-map-id="${escapeHtml(m.id)}">
      <span class="map-dot">${m.id === state.activeMapId ? '●' : '○'}</span>
      <span class="map-option-name">${escapeHtml(m.name)}</span>
      <button class="map-option-action" data-rename-id="${escapeHtml(m.id)}" title="Rename">✎</button>
      ${canDelete ? `<button class="map-option-action danger" data-delete-id="${escapeHtml(m.id)}" title="Delete">✕</button>` : ''}
    </div>
  `).join('');

  dropdown.innerHTML = `
    ${mapOptions}
    <div class="map-sep"></div>
    <div class="map-action" data-action="new-map"><span class="map-action-icon">＋</span>New Map</div>
    <div class="map-sep"></div>
    <div class="map-action" data-action="import"><span class="map-action-icon">⬇</span>Import...</div>
    <div class="map-action" data-action="export-map"><span class="map-action-icon">⬆</span>Export Active Map</div>
    <div class="map-action" data-action="export-bundle"><span class="map-action-icon">⬆</span>Export All (Backup)</div>
    <div class="map-sep"></div>
    <div class="map-action" data-action="manage-icons"><span class="map-action-icon">✦</span>Manage Icons...</div>
    ${__WEB_BUILD__ ? `
    <div class="map-sep"></div>
    <div class="map-action" data-action="download-app"><span class="map-action-icon">⤓</span>Download Offline Copy</div>
    ` : ''}
  `;

  // Map switching (click on option, not on action buttons)
  dropdown.querySelectorAll('.map-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.map-option-action')) return;
      e.stopPropagation();
      const mapId = (opt as HTMLElement).dataset.mapId!;
      const state = getState();
      state.activeMapId = mapId;
      setState(state);
      dropdown.classList.add('hidden');
      btn.classList.remove('open');
      renderDropdown();
    });
  });

  // Rename map
  dropdown.querySelectorAll('[data-rename-id]').forEach(renameBtn => {
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mapId = (renameBtn as HTMLElement).dataset.renameId!;
      const state = getState();
      const map = state.maps.find(m => m.id === mapId);
      if (!map) return;

      // Replace the option with an inline input
      const option = (renameBtn as HTMLElement).closest('.map-option')!;
      const nameEl = option.querySelector('.map-option-name') as HTMLElement;
      const originalName = map.name;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'map-rename-input';
      input.value = originalName;
      nameEl.replaceWith(input);
      input.focus();
      input.select();

      // Hide action buttons while renaming
      option.querySelectorAll('.map-option-action').forEach(b => (b as HTMLElement).style.display = 'none');

      const commit = () => {
        const newName = input.value.trim();
        if (newName && newName !== originalName) {
          const state = getState();
          const nameTaken = state.maps.some(
            m => m.id !== mapId && m.name.toLowerCase() === newName.toLowerCase()
          );
          if (nameTaken) {
            alert(`A map named "${newName}" already exists.`);
            renderDropdown();
            return;
          }
          const map = state.maps.find(m => m.id === mapId);
          if (map) {
            map.name = newName;
            map.updatedAt = new Date().toISOString();
            setState(state);
          }
        }
        renderDropdown();
      };

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') commit();
        if (ev.key === 'Escape') renderDropdown();
      });
      input.addEventListener('blur', commit);
    });
  });

  // Delete map
  dropdown.querySelectorAll('[data-delete-id]').forEach(deleteBtn => {
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mapId = (deleteBtn as HTMLElement).dataset.deleteId!;
      const state = getState();
      if (state.maps.length <= 1) return; // can't delete last map

      const map = state.maps.find(m => m.id === mapId);
      if (!map) return;

      if (!confirm(`Delete "${map.name}"? This cannot be undone.`)) return;

      state.maps = state.maps.filter(m => m.id !== mapId);
      if (state.activeMapId === mapId) {
        state.activeMapId = state.maps[0].id;
      }
      setState(state);
      dropdown.classList.add('hidden');
      btn.classList.remove('open');
      renderDropdown();
    });
  });

  // New map - dispatch event so modals.ts shows the prompt
  dropdown.querySelector('[data-action="new-map"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.add('hidden');
    btn.classList.remove('open');
    document.dispatchEvent(new CustomEvent('netgraph:new-map'));
  });

  // Import
  dropdown.querySelector('[data-action="import"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.add('hidden');
    btn.classList.remove('open');
    pickAndImport();
  });

  // Export - active map (with referenced custom icons inlined)
  dropdown.querySelector('[data-action="export-map"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.add('hidden');
    btn.classList.remove('open');
    const state = getState();
    const map = getActiveMap(state);
    downloadJson(map.name, exportMap(map, state.customIcons ?? []));
  });

  // Export - full bundle (opens a dialog for filename so multiple backups
  // don't overwrite each other in the user's Downloads folder)
  dropdown.querySelector('[data-action="export-bundle"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.add('hidden');
    btn.classList.remove('open');
    document.dispatchEvent(new CustomEvent('netgraph:export-bundle'));
  });

  // Manage Icons
  dropdown.querySelector('[data-action="manage-icons"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.add('hidden');
    btn.classList.remove('open');
    document.dispatchEvent(new CustomEvent('netgraph:manage-icons'));
  });

  // Download Offline Copy - present only on the deployed web build
  dropdown.querySelector('[data-action="download-app"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.add('hidden');
    btn.classList.remove('open');
    void downloadOfflineCopy();
  });
}

/**
 * Download the self-contained single-file build (`download/netgraph.html`).
 * It's fetched and re-wrapped as an `application/octet-stream` blob so the
 * browser always saves it - an octet-stream can't be rendered as a page, so
 * there's no risk of navigating to the HTML instead of downloading it.
 */
async function downloadOfflineCopy(): Promise<void> {
  try {
    const res = await fetch('download/netgraph.html');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const url = URL.createObjectURL(new Blob([html], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'netgraph.html';
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    alert('Could not download the offline copy. Please try again.');
  }
}
