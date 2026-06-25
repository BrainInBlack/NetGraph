import { bindOverlayDismiss, pushModalLock, popModalLock, trapFocus, q } from '../../util';

// ── Primary modal plumbing ───────────────────────────────────
//
// One `#modal-overlay` element hosts a single dialog at a time. `showModal`
// injects markup and traps focus; `dismissModal` tears it down. Stacked
// overlays (icon picker, import flow) are handled separately in util.ts.

let releaseTrap: (() => void) | null = null;
let overlayClickBound = false;

export function showModal(content: string): HTMLElement {
  const overlay = document.getElementById('modal-overlay')!;
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${content}</div>`;
  overlay.classList.remove('hidden');
  pushModalLock();

  // Bind backdrop click exactly once — repeated showModal calls would otherwise
  // stack listeners on the long-lived #modal-overlay element.
  if (!overlayClickBound) {
    bindOverlayDismiss(overlay, dismissModal);
    overlayClickBound = true;
  }

  const modal = q<HTMLElement>(overlay, '.modal');
  releaseTrap?.();
  releaseTrap = trapFocus(modal);
  return modal;
}

export function dismissModal(): void {
  const overlay = document.getElementById('modal-overlay')!;
  if (overlay.classList.contains('hidden')) return; // already dismissed
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
  releaseTrap?.();
  releaseTrap = null;
  popModalLock();
}
