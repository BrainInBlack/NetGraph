import { escapeHtml, q } from '../../util';
import type { LinkPort, LinkSide, NamedPort } from '../../types';
import { NAMED_PORTS } from '../../types';

// Shared form fields for the Add Connection + Edit Connection modals: the port
// input (with named-port quick-fill) and the 3x3 side picker.

/**
 * Parse a port input. Accepts either a positive integer 1-256 or one of the
 * named ports (case-sensitive). Empty / whitespace returns `undefined` to mean
 * "no port set". Everything else returns `null` so the caller can show an
 * error without confusing it with "user chose to clear the field".
 */
export function parsePortInput(raw: string): LinkPort | undefined | null {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if ((NAMED_PORTS as readonly string[]).includes(trimmed)) return trimmed as NamedPort;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isInteger(n) && n >= 1 && n <= 256) return n;
  }
  return null;
}

/**
 * Render the side picker as a 3x3 grid: top/right/bottom/left edge buttons
 * plus a center "Auto" button. The container has `data-value` reflecting the
 * current selection (empty string = Auto).
 */
export function renderSidePicker(id: string, current: LinkSide | undefined): string {
  const sel = (v: string) => ((current ?? '') === v ? ' selected' : '');
  return `
    <div class="side-picker" id="${id}" data-value="${current ?? ''}" role="radiogroup" aria-label="Side">
      <button type="button" class="side-pick side-top${sel('top')}" data-value="top" aria-label="Top"></button>
      <button type="button" class="side-pick side-left${sel('left')}" data-value="left" aria-label="Left"></button>
      <button type="button" class="side-pick side-auto${sel('')}" data-value="" aria-label="Auto">Auto</button>
      <button type="button" class="side-pick side-right${sel('right')}" data-value="right" aria-label="Right"></button>
      <button type="button" class="side-pick side-bottom${sel('bottom')}" data-value="bottom" aria-label="Bottom"></button>
    </div>
  `;
}

/** Render a port input + named-port quick buttons. */
export function renderPortInput(id: string, current: LinkPort | undefined): string {
  const value = current == null ? '' : String(current);
  const namedBtns = NAMED_PORTS.map(n =>
    `<button type="button" class="port-name-btn" data-name="${n}">${n}</button>`
  ).join('');
  return `
    <input type="text" class="port-input" id="${id}" value="${escapeHtml(value)}" placeholder="1-256 or named" autocomplete="off" />
    <div class="port-names" data-input="${id}">
      <button type="button" class="port-name-btn port-name-clear" data-name="">Clear</button>
      ${namedBtns}
    </div>
  `;
}

/** Wire up a side-picker container's click handlers. Returns a getter for the value. */
export function bindSidePicker(container: HTMLElement): () => LinkSide | undefined {
  container.querySelectorAll<HTMLButtonElement>('.side-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      container.dataset.value = btn.dataset.value ?? '';
      container.querySelectorAll<HTMLButtonElement>('.side-pick').forEach(b => b.classList.toggle('selected', b === btn));
    });
  });
  return () => {
    const v = container.dataset.value ?? '';
    return v === '' ? undefined : (v as LinkSide);
  };
}

/** Wire up a port-input field with its quick-fill named buttons. */
export function bindPortInput(modal: HTMLElement, inputId: string): void {
  const input = q<HTMLInputElement>(modal, `#${inputId}`);
  const buttons = modal.querySelectorAll<HTMLButtonElement>(`.port-names[data-input="${inputId}"] .port-name-btn`);
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.name ?? '';
      input.focus();
    });
  });
}
