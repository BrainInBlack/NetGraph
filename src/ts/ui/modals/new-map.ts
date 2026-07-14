import { getState, setState } from '../../state';
import { createEmptyMap } from '../../storage';
import { createExampleMap, withExampleIcons } from '../../example-map';
import { q, nextFrame } from '../../util';
import { renderDropdown } from '../toolbar';
import { showModal, dismissModal } from './shared';

// -- New Map --------------------------------------------------

export function showNewMapModal(): void {
  const state = getState();
  const defaultName = `Network ${state.maps.length + 1}`;

  const modal = showModal(`
    <div class="modal-header">New Map</div>
    <div class="modal-body">
      <div class="form-row">
        <label>Map Name</label>
        <input type="text" id="modal-map-name" value="${defaultName}" placeholder="e.g. Home Network" />
        <div id="modal-map-name-error" class="form-error"></div>
      </div>
      <label class="form-checkbox">
        <input type="checkbox" id="modal-map-seed" />
        <span>Include example devices to get started</span>
      </label>
    </div>
    <div class="modal-footer">
      <button class="modal-btn secondary" id="modal-cancel">Cancel</button>
      <button class="modal-btn primary" id="modal-save">Create</button>
    </div>
  `);

  const input = q<HTMLInputElement>(modal, '#modal-map-name');
  const errorEl = q<HTMLElement>(modal, '#modal-map-name-error');
  const seedCheckbox = q<HTMLInputElement>(modal, '#modal-map-seed');

  nextFrame(() => { input.focus(); input.select(); });

  input.addEventListener('input', () => { errorEl.textContent = ''; });

  const submit = () => {
    const name = input.value.trim();
    if (!name) {
      errorEl.textContent = 'Name is required';
      return;
    }
    const state = getState();
    if (state.maps.some(m => m.name.toLowerCase() === name.toLowerCase())) {
      errorEl.textContent = `A map named "${name}" already exists`;
      return;
    }
    let newMap;
    if (seedCheckbox.checked) {
      newMap = createExampleMap(name);
      // The example references a custom icon; make sure it exists for users
      // whose library predates it, or the home-server card shows the ? glyph.
      state.customIcons = withExampleIcons(state.customIcons);
    } else {
      newMap = createEmptyMap(name);
    }
    state.maps.push(newMap);
    state.activeMapId = newMap.id;
    setState(state);
    renderDropdown();
    dismissModal();
  };

  q(modal, '#modal-cancel').addEventListener('click', dismissModal);
  q(modal, '#modal-save').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); dismissModal(); }
  });
}
