import { getState, setState } from '../state';
import { generateId } from '../util';
import { parseImport, ImportError, type ParsedImport } from '../import-export';
import { renderIconHtml } from '../icons';
import { escapeHtml, nextFrame, q, pushModalLock, popModalLock, ensureStackedOverlay, Z_STACKED_OVERLAY, trapFocus } from '../util';
import { renderDropdown } from './toolbar';
import type { CustomIcon, NetworkMap } from '../types';

// ── Per-conflict resolution choices ──────────────────────────

type IconResolution =
  | { type: 'rename'; newName: string }
  | { type: 'use-existing'; existingId: string }
  | { type: 'skip' };

type MapResolution =
  | { type: 'rename'; newName: string }
  | { type: 'replace'; existingId: string }
  | { type: 'skip' };

interface IconConflict {
  incoming: CustomIcon;          // from the import
  existing: CustomIcon;           // collided existing icon
  resolution: IconResolution;
}

interface MapConflict {
  incoming: NetworkMap;
  existing: NetworkMap;
  resolution: MapResolution;
}

// ── Public entry point ──────────────────────────────────────

/**
 * Open a hidden file picker; once the user chooses a JSON file, parse it,
 * detect conflicts, and either apply directly or open the resolution modal.
 */
export function pickAndImport(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    document.body.removeChild(input);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseImport(text);
      startImport(parsed);
    } catch (err) {
      const msg = err instanceof ImportError ? err.message : `Import failed: ${(err as Error).message}`;
      alert(msg);
    }
  });
  document.body.appendChild(input);
  input.click();
}

function startImport(parsed: ParsedImport): void {
  const state = getState();
  const existingIcons = state.customIcons ?? [];
  const existingMaps = state.maps;

  // Detect icon conflicts (case-insensitive name match)
  const iconConflicts: IconConflict[] = [];
  for (const icon of parsed.customIcons) {
    const collision = existingIcons.find(c => c.name.toLowerCase() === icon.name.toLowerCase());
    if (collision) {
      iconConflicts.push({
        incoming: icon,
        existing: collision,
        resolution: { type: 'rename', newName: uniqueName(icon.name, existingIcons.map(c => c.name)) },
      });
    }
  }

  const mapConflicts: MapConflict[] = [];
  for (const map of parsed.maps) {
    const collision = existingMaps.find(m => m.name.toLowerCase() === map.name.toLowerCase());
    if (collision) {
      mapConflicts.push({
        incoming: map,
        existing: collision,
        resolution: { type: 'rename', newName: uniqueName(map.name, existingMaps.map(m => m.name)) },
      });
    }
  }

  const isBundle = parsed.kind === 'bundle';

  if (iconConflicts.length === 0 && mapConflicts.length === 0 && !isBundle) {
    // Nothing to resolve and not a bundle — just apply
    applyImport(parsed, [], [], 'append');
    return;
  }

  showConflictModal(parsed, iconConflicts, mapConflicts, isBundle);
}

// ── Conflict resolution UI ──────────────────────────────────

function showConflictModal(
  parsed: ParsedImport,
  iconConflicts: IconConflict[],
  mapConflicts: MapConflict[],
  isBundle: boolean,
): void {
  const overlay = ensureOverlay();
  overlay.innerHTML = render(parsed, iconConflicts, mapConflicts, isBundle, 'append');
  overlay.style.display = 'flex';
  pushModalLock();
  const releaseTrap = trapFocus(overlay);

  // Re-render helper — preserves all radio/text-input state by reading the
  // resolution objects (which we mutate in place as the user toggles things)
  let mode: 'append' | 'replace-all' = 'append';

  function rerender(): void {
    overlay.innerHTML = render(parsed, iconConflicts, mapConflicts, isBundle, mode);
    bindHandlers();
  }

  function close(): void {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    releaseTrap();
    popModalLock();
  }

  function bindHandlers(): void {
    // Bundle "replace everything" toggle
    overlay.querySelectorAll<HTMLInputElement>('input[name="bundle-mode"]').forEach(r => {
      r.addEventListener('change', () => {
        mode = r.value as 'append' | 'replace-all';
        rerender();
      });
    });

    // Per-conflict resolution radios
    iconConflicts.forEach((conflict, i) => {
      bindConflictHandlers<IconResolution>(
        overlay,
        `icon-${i}`,
        conflict.resolution,
        r => { conflict.resolution = r; },
        () => uniqueName(conflict.incoming.name, [
          ...(getState().customIcons ?? []).map(c => c.name),
          ...iconConflicts.filter(x => x !== conflict && x.resolution.type === 'rename').map(x => (x.resolution as { newName: string }).newName),
        ]),
        conflict.existing.id,
      );
    });
    mapConflicts.forEach((conflict, i) => {
      bindConflictHandlers<MapResolution>(
        overlay,
        `map-${i}`,
        conflict.resolution,
        r => { conflict.resolution = r; },
        () => uniqueName(conflict.incoming.name, [
          ...getState().maps.map(m => m.name),
          ...mapConflicts.filter(x => x !== conflict && x.resolution.type === 'rename').map(x => (x.resolution as { newName: string }).newName),
        ]),
        conflict.existing.id,
        true, // map (uses 'replace' instead of 'use-existing')
      );
    });

    q(overlay, '#import-cancel').addEventListener('click', close);
    q(overlay, '#import-confirm').addEventListener('click', () => {
      // Validate any rename inputs are non-empty and unique
      const allRenames: string[] = [];
      for (const c of iconConflicts) {
        if (c.resolution.type === 'rename') {
          const name = c.resolution.newName.trim();
          if (!name) { alert('All icon rename fields must have a name.'); return; }
          if (allRenames.includes(name.toLowerCase())) { alert(`Duplicate icon rename: "${name}".`); return; }
          allRenames.push(name.toLowerCase());
          c.resolution.newName = name;
        }
      }
      const allMapRenames: string[] = [];
      for (const c of mapConflicts) {
        if (c.resolution.type === 'rename') {
          const name = c.resolution.newName.trim();
          if (!name) { alert('All map rename fields must have a name.'); return; }
          if (allMapRenames.includes(name.toLowerCase())) { alert(`Duplicate map rename: "${name}".`); return; }
          allMapRenames.push(name.toLowerCase());
          c.resolution.newName = name;
        }
      }

      const applied = applyImport(parsed, iconConflicts, mapConflicts, mode);
      // Keep the modal open if the user cancelled the destructive confirm —
      // they may want to switch back to "Append" or tweak something else
      // rather than starting the whole import over.
      if (applied) close();
    });
  }

  bindHandlers();

  // Focus first input
  nextFrame(() => {
    const firstInput = overlay.querySelector<HTMLInputElement>('input[type="text"]');
    firstInput?.focus();
  });
}

function bindConflictHandlers<R extends { type: string }>(
  overlay: HTMLElement,
  prefix: string,
  resolution: R,
  setResolution: (r: R) => void,
  defaultRenameSuggestion: () => string,
  existingId: string,
  isMap = false,
): void {
  const radios = overlay.querySelectorAll<HTMLInputElement>(`input[name="${prefix}"]`);
  radios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.value === 'rename') {
        const input = overlay.querySelector<HTMLInputElement>(`#${prefix}-name`);
        const name = input?.value.trim() || defaultRenameSuggestion();
        setResolution({ type: 'rename', newName: name } as unknown as R);
      } else if (r.value === 'use-existing' || r.value === 'replace') {
        const t = isMap ? 'replace' : 'use-existing';
        setResolution({ type: t, existingId } as unknown as R);
      } else {
        setResolution({ type: 'skip' } as unknown as R);
      }
    });
  });
  const renameInput = overlay.querySelector<HTMLInputElement>(`#${prefix}-name`);
  renameInput?.addEventListener('input', () => {
    if (resolution.type === 'rename') {
      (resolution as unknown as { newName: string }).newName = renameInput.value;
    }
  });
}

// ── HTML rendering ───────────────────────────────────────────

function render(
  parsed: ParsedImport,
  iconConflicts: IconConflict[],
  mapConflicts: MapConflict[],
  isBundle: boolean,
  mode: 'append' | 'replace-all',
): string {
  const summary = isBundle
    ? `Importing <strong>${parsed.maps.length}</strong> map${parsed.maps.length === 1 ? '' : 's'} and <strong>${parsed.customIcons.length}</strong> custom icon${parsed.customIcons.length === 1 ? '' : 's'}.`
    : `Importing map <strong>${escapeHtml(parsed.maps[0].name)}</strong>${parsed.customIcons.length ? ` with <strong>${parsed.customIcons.length}</strong> custom icon${parsed.customIcons.length === 1 ? '' : 's'}` : ''}.`;

  const bundleModeBlock = isBundle ? `
    <div class="import-section">
      <div class="import-section-title">Mode</div>
      <label class="import-radio-row">
        <input type="radio" name="bundle-mode" value="append" ${mode === 'append' ? 'checked' : ''} />
        <span><strong>Append</strong> — add the imported maps and icons alongside your existing ones.</span>
      </label>
      <label class="import-radio-row danger-row">
        <input type="radio" name="bundle-mode" value="replace-all" ${mode === 'replace-all' ? 'checked' : ''} />
        <span><strong>Replace everything</strong> — wipe all current maps and custom icons. <em>This cannot be undone.</em></span>
      </label>
    </div>
  ` : '';

  const showConflicts = mode !== 'replace-all';

  const iconBlocks = showConflicts && iconConflicts.length > 0 ? `
    <div class="import-section">
      <div class="import-section-title">Custom Icon Conflicts (${iconConflicts.length})</div>
      ${iconConflicts.map((c, i) => renderIconConflict(c, i)).join('')}
    </div>
  ` : '';

  const mapBlocks = showConflicts && mapConflicts.length > 0 ? `
    <div class="import-section">
      <div class="import-section-title">Map Conflicts (${mapConflicts.length})</div>
      ${mapConflicts.map((c, i) => renderMapConflict(c, i)).join('')}
    </div>
  ` : '';

  return `
    <div class="modal import-modal" role="dialog" aria-modal="true" aria-label="Import">
      <div class="modal-header">Import</div>
      <div class="modal-body">
        <p>${summary}</p>
        ${bundleModeBlock}
        ${iconBlocks}
        ${mapBlocks}
      </div>
      <div class="modal-footer">
        <button class="modal-btn secondary" id="import-cancel">Cancel</button>
        <button class="modal-btn primary" id="import-confirm">Import</button>
      </div>
    </div>
  `;
}

function renderIconConflict(conflict: IconConflict, idx: number): string {
  const customIcons = getState().customIcons ?? [];
  const previewIncoming = conflict.incoming.kind === 'svg'
    ? conflict.incoming.data
    : `<img src="${escapeHtml(conflict.incoming.data)}" alt="" />`;
  const previewExisting = renderIconHtml(`custom:${conflict.existing.id}`, customIcons);
  const renameValue = conflict.resolution.type === 'rename' ? conflict.resolution.newName : '';
  const checked = (t: string) => conflict.resolution.type === t ? 'checked' : '';

  return `
    <div class="import-conflict">
      <div class="import-conflict-head">
        <div class="import-conflict-preview">${previewIncoming}</div>
        <div class="import-conflict-vs">↔</div>
        <div class="import-conflict-preview">${previewExisting}</div>
        <div class="import-conflict-name">
          <strong>${escapeHtml(conflict.incoming.name)}</strong>
          <span class="import-conflict-note">already exists</span>
        </div>
      </div>
      <div class="import-conflict-options">
        <label class="import-radio-row">
          <input type="radio" name="icon-${idx}" value="rename" ${checked('rename')} />
          <span>Rename imported to:</span>
          <input type="text" id="icon-${idx}-name" value="${escapeHtml(renameValue)}" />
        </label>
        <label class="import-radio-row">
          <input type="radio" name="icon-${idx}" value="use-existing" ${checked('use-existing')} />
          <span>Use existing icon (devices in import will point to it)</span>
        </label>
        <label class="import-radio-row">
          <input type="radio" name="icon-${idx}" value="skip" ${checked('skip')} />
          <span>Skip (devices fall back to their type's default icon)</span>
        </label>
      </div>
    </div>
  `;
}

function renderMapConflict(conflict: MapConflict, idx: number): string {
  const renameValue = conflict.resolution.type === 'rename' ? conflict.resolution.newName : '';
  const checked = (t: string) => conflict.resolution.type === t ? 'checked' : '';

  return `
    <div class="import-conflict">
      <div class="import-conflict-head">
        <div class="import-conflict-name">
          <strong>${escapeHtml(conflict.incoming.name)}</strong>
          <span class="import-conflict-note">already exists</span>
        </div>
      </div>
      <div class="import-conflict-options">
        <label class="import-radio-row">
          <input type="radio" name="map-${idx}" value="rename" ${checked('rename')} />
          <span>Rename imported to:</span>
          <input type="text" id="map-${idx}-name" value="${escapeHtml(renameValue)}" />
        </label>
        <label class="import-radio-row danger-row">
          <input type="radio" name="map-${idx}" value="replace" ${checked('replace')} />
          <span>Replace existing map (its devices and links will be lost)</span>
        </label>
        <label class="import-radio-row">
          <input type="radio" name="map-${idx}" value="skip" ${checked('skip')} />
          <span>Skip</span>
        </label>
      </div>
    </div>
  `;
}

// ── Apply ────────────────────────────────────────────────────

/**
 * Apply the import to the state. Returns `true` if state was updated, or
 * `false` if the user backed out of a destructive confirmation — in that case
 * the conflict modal stays open so they can pick a different mode.
 */
function applyImport(
  parsed: ParsedImport,
  iconConflicts: IconConflict[],
  mapConflicts: MapConflict[],
  mode: 'append' | 'replace-all',
): boolean {
  const state = getState();

  // Bundle "replace everything" — wipe and load
  if (mode === 'replace-all' && parsed.kind === 'bundle') {
    if (!confirm('Replace everything? Your current maps and custom icons will be permanently deleted.')) {
      return false;
    }

    // Regenerate IDs even on replace-all to keep them unique to this install
    const iconIdMap = new Map<string, string>();
    const newIcons = parsed.customIcons.map(icon => {
      const newId = generateId();
      iconIdMap.set(icon.id, newId);
      return { ...icon, id: newId };
    });
    const newMaps = parsed.maps.map(map => translateMapIds(map, iconIdMap));
    // Always activate the first imported map — predictable, ignores the
    // bundle's saved activeMapId hint (which mostly reflects whatever map
    // the exporter happened to have selected).
    const newActive = newMaps[0].id;

    setState({ activeMapId: newActive, maps: newMaps, customIcons: newIcons });
    renderDropdown();
    return true;
  }

  // Append flow — translate IDs, apply per-conflict resolutions
  const iconIdMap = new Map<string, string>();
  const iconsToAdd: CustomIcon[] = [];

  // Non-conflicting icons → add with new ID
  const conflictingIncomingIds = new Set(iconConflicts.map(c => c.incoming.id));
  for (const icon of parsed.customIcons) {
    if (conflictingIncomingIds.has(icon.id)) continue;
    const newId = generateId();
    iconIdMap.set(icon.id, newId);
    iconsToAdd.push({ ...icon, id: newId });
  }

  // Conflicting icons → resolve per choice
  for (const c of iconConflicts) {
    if (c.resolution.type === 'rename') {
      const newId = generateId();
      iconIdMap.set(c.incoming.id, newId);
      iconsToAdd.push({ ...c.incoming, id: newId, name: c.resolution.newName });
    } else if (c.resolution.type === 'use-existing') {
      iconIdMap.set(c.incoming.id, c.resolution.existingId);
    }
    // 'skip' → no entry in iconIdMap → device.iconId becomes 'custom:<old>' which falls back to "icon not found"
  }

  const conflictByIncomingId = new Map(mapConflicts.map(c => [c.incoming.id, c]));
  const mapsToAdd: NetworkMap[] = [];
  const mapsToReplaceById = new Map<string, NetworkMap>(); // existingId → new map (replaces in place)

  // Walk parsed.maps in import order so we can pick the first surviving map
  // for post-import activation. Imported map IDs are throwaway — for append
  // we mint fresh ones so they can't collide; for replace we keep the
  // existing map's ID (and its createdAt for posterity).
  let firstImportedMapId: string | undefined;
  for (const map of parsed.maps) {
    const conflict = conflictByIncomingId.get(map.id);
    let finalId: string | undefined;
    if (!conflict) {
      finalId = generateId();
      mapsToAdd.push({ ...translateMapIds(map, iconIdMap), id: finalId });
    } else if (conflict.resolution.type === 'rename') {
      finalId = generateId();
      mapsToAdd.push({ ...translateMapIds(map, iconIdMap), id: finalId, name: conflict.resolution.newName });
    } else if (conflict.resolution.type === 'replace') {
      finalId = conflict.resolution.existingId;
      mapsToReplaceById.set(finalId, translateMapIds(map, iconIdMap));
    }
    // 'skip' → no finalId; this map doesn't make it into state, move on
    if (finalId && !firstImportedMapId) firstImportedMapId = finalId;
  }

  const newCustomIcons = [...(state.customIcons ?? []), ...iconsToAdd];
  const newMapsList = state.maps
    .map(m => mapsToReplaceById.has(m.id)
      ? { ...mapsToReplaceById.get(m.id)!, id: m.id, createdAt: m.createdAt, updatedAt: new Date().toISOString() }
      : m)
    .concat(mapsToAdd);

  setState({
    // Activate the first imported map that survived (skip-all leaves the
    // current map active, which is the only sensible fallback).
    activeMapId: firstImportedMapId ?? state.activeMapId,
    maps: newMapsList,
    customIcons: newCustomIcons,
  });
  renderDropdown();
  return true;
}

/** Apply the icon ID translation map to a NetworkMap's device.iconId fields. */
function translateMapIds(map: NetworkMap, iconIdMap: Map<string, string>): NetworkMap {
  return {
    ...map,
    devices: map.devices.map(d => {
      if (!d.iconId?.startsWith('custom:')) return d;
      const oldId = d.iconId.slice('custom:'.length);
      const newId = iconIdMap.get(oldId);
      return { ...d, iconId: newId ? `custom:${newId}` : d.iconId /* falls back at render time */ };
    }),
  };
}

// ── Helpers ──────────────────────────────────────────────────

/** Generate a unique name by appending " (2)", " (3)", … if needed. */
function uniqueName(base: string, taken: string[]): string {
  const lower = new Set(taken.map(t => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  let i = 2;
  while (lower.has(`${base} (${i})`.toLowerCase())) i++;
  return `${base} (${i})`;
}

function ensureOverlay(): HTMLElement {
  return ensureStackedOverlay('import-overlay', Z_STACKED_OVERLAY);
}
