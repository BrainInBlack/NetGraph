import { escapeHtml, q, nextFrame } from '../../util';
import { showModal, dismissModal } from './shared';

// -- Export Bundle --------------------------------------------

export function showExportBundleModal(): void {
  // Pre-fill with a dated filename so multiple backups don't overwrite each
  // other in the user's Downloads folder.
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const defaultName = `netgraph-backup-${today}`;

  const modal = showModal(`
    <div class="modal-header">Export All (Backup)</div>
    <div class="modal-body">
      <div class="form-row">
        <label>Filename</label>
        <input type="text" id="modal-export-name" value="${escapeHtml(defaultName)}" />
        <span class="form-hint">.json will be appended automatically</span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn secondary" id="modal-cancel">Cancel</button>
      <button class="modal-btn primary" id="modal-save">Download</button>
    </div>
  `);

  const input = q<HTMLInputElement>(modal, '#modal-export-name');
  nextFrame(() => { input.focus(); input.select(); });

  const submit = () => {
    const raw = input.value.trim();
    if (!raw) return;
    // Dispatch with the chosen filename - toolbar.ts builds + downloads
    document.dispatchEvent(new CustomEvent('netgraph:export-bundle-confirmed', { detail: { filename: raw } }));
    dismissModal();
  };

  q(modal, '#modal-cancel').addEventListener('click', dismissModal);
  q(modal, '#modal-save').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); dismissModal(); }
  });
}
