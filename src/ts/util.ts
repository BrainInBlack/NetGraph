import type { Link } from './types';

/** Grid snap size in canvas units. Must match $grid-sm in _variables.scss. */
const GRID_SIZE = 24;

/**
 * True if a link already connects devices `a` and `b` (either direction).
 * Used by both connect-mode's duplicate-blocking ghost and the device
 * editor's auto-create-host-link dedupe so the "one pair = one wire" rule
 * lives in one place.
 */
export function linkExists(links: Link[], a: string, b: string): boolean {
  return links.some(l =>
    (l.sourceId === a && l.targetId === b) ||
    (l.sourceId === b && l.targetId === a)
  );
}

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/**
 * Wire click-to-dismiss onto a modal overlay element, ignoring clicks that
 * are the tail end of a text-selection drag starting inside the dialog.
 *
 * The naive `e.target === overlay` check fires for both a genuine backdrop
 * click AND the synthetic click that follows a mousedown-inside / mouseup-
 * outside drag — because the click event bubbles to the common ancestor.
 * We track where the pointer first went down and only dismiss when both the
 * pointerdown and the eventual click landed on the overlay itself.
 *
 * Safe to call once at overlay creation; the handler is idempotent
 * w.r.t. drags vs. real clicks.
 */
export function bindOverlayDismiss(overlay: HTMLElement, dismiss: () => void): void {
  let pointerDownOnOverlay = false;
  overlay.addEventListener('pointerdown', (e) => {
    pointerDownOnOverlay = e.target === overlay;
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && pointerDownOnOverlay) dismiss();
    pointerDownOnOverlay = false;
  });
}

/**
 * Wire arrow-key (+ Home / End) navigation onto a flat ARIA radiogroup.
 * Pass the container element and the selector that finds the individual
 * radio buttons inside it. Moves focus to the next/previous radio and
 * synthesizes a click() so the existing click handler updates aria-checked
 * (we don't duplicate that logic here).
 *
 * Wraps at both ends. Doesn't touch tabindex — Tab still walks each radio,
 * which is fine for the small (2–3 option) groups we use this on. For the
 * strict ARIA roving-tabindex pattern, a future caller would manage tabindex
 * inside its click handler.
 */
export function bindRadioGroupKeys(container: HTMLElement, radioSelector: string): void {
  container.addEventListener('keydown', (e) => {
    const radios = Array.from(container.querySelectorAll<HTMLElement>(radioSelector));
    if (radios.length === 0) return;
    const current = document.activeElement instanceof HTMLElement
      ? radios.indexOf(document.activeElement)
      : -1;
    let next = current;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = current < 0 ? 0 : (current + 1) % radios.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = current <= 0 ? radios.length - 1 : current - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = radios.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    radios[next].focus();
    radios[next].click();
  });
}

/** Fresh random ID. Wraps `crypto.randomUUID` — kept centralized in case we
 *  need to swap impls (older browsers, deterministic test mode, etc.). */
export function generateId(): string {
  return crypto.randomUUID();
}

/** Escape user-controlled strings for safe interpolation into innerHTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Run after the next paint — more reliable than setTimeout(0/50) for focusing freshly inserted inputs. */
export function nextFrame(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/**
 * Typed lookup for an SVG root element by id. `getElementById` is typed to
 * return `HTMLElement`, which doesn't narrow to `SVGSVGElement` (sibling types),
 * forcing an `as unknown as` cast. `querySelector` with a type parameter returns
 * the right type directly. Ids here are literal constants, so the `#${id}`
 * selector is safe.
 */
export function getSvgRoot(id: string): SVGSVGElement | null {
  return document.querySelector<SVGSVGElement>(`#${id}`);
}

/**
 * Stacking-order constants for dynamically-created overlays. Mirrors the
 * `$z-*` values in `_variables.scss`. Keep both sides in sync.
 */
export const Z_STACKED_OVERLAY = 2050;       // icon-manager, import-modal
export const Z_ICON_PICKER_OVERLAY = 2100;   // sits above the device modal AND the stacked group

/**
 * Lazily create (or reuse) a fixed-position backdrop overlay appended to
 * <body>. The actual styling comes from the `.stacked-overlay` SCSS class;
 * only the z-index varies per caller, so we set it inline.
 *
 * Callers toggle visibility via `overlay.style.display = 'flex' | 'none'`.
 */
export function ensureStackedOverlay(id: string, zIndex: number): HTMLElement {
  let overlay = document.getElementById(id);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'stacked-overlay';
    overlay.style.zIndex = String(zIndex);
    document.body.appendChild(overlay);
  }
  return overlay;
}

/**
 * Modal-lock counter. Multiple modals may stack on top of each other (e.g. the
 * icon picker rides on top of the Edit Device modal). The body should only
 * lose `modal-active` when the *last* one closes, so every modal-like overlay
 * should push on open and pop on close.
 */
let openModalCount = 0;

export function pushModalLock(): void {
  openModalCount++;
  document.body.classList.add('modal-active');
}

export function popModalLock(): void {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) document.body.classList.remove('modal-active');
}

/**
 * Trap keyboard focus inside `container`. Tabbing past the last focusable
 * element wraps to the first; shift-tabbing from the first wraps to the last.
 * Returns a teardown function to release the trap.
 *
 * Used by every modal so keyboard users can't accidentally tab into the
 * canvas behind a dialog.
 */
export function trapFocus(container: HTMLElement): () => void {
  const FOCUSABLE = 'input, select, textarea, button, [tabindex]:not([tabindex="-1"])';

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const els = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (els.length === 0) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  container.addEventListener('keydown', onKeydown);
  return () => container.removeEventListener('keydown', onKeydown);
}

/**
 * Long-press detector for touch interactions. Returns helpers for the three
 * lifecycle moments — start, move, end — that the caller wires into their
 * pointer handlers. The callback fires once after `delay` ms if the user
 * hasn't lifted off or moved past `moveThreshold` pixels.
 *
 * Only triggers for `pointerType === 'touch'`; mouse and pen already have
 * native right-click for context menus.
 */
export function createLongPress(
  delay = 500,
  moveThreshold = 8,
): {
  start: (e: PointerEvent, onFire: () => void) => void;
  move: (e: PointerEvent) => void;
  cancel: () => void;
} {
  let timer: number | null = null;
  let startX = 0;
  let startY = 0;
  let activeId: number | null = null;

  const clear = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    activeId = null;
  };

  return {
    start(e, onFire) {
      if (e.pointerType !== 'touch') return;
      activeId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      timer = window.setTimeout(() => {
        timer = null;
        onFire();
      }, delay);
    },
    move(e) {
      if (timer === null || e.pointerId !== activeId) return;
      if (Math.abs(e.clientX - startX) > moveThreshold ||
          Math.abs(e.clientY - startY) > moveThreshold) {
        clear();
      }
    },
    cancel: clear,
  };
}

/**
 * Typed querySelector. Throws if no element matches — in code where the
 * markup is controlled by the same module (e.g. a modal we just rendered),
 * a miss indicates a bug, not a runtime condition to handle.
 *
 * Usage:
 *   q(root, '#close-btn').addEventListener('click', ...);            // T = Element
 *   q<HTMLInputElement>(root, '#name').value;                        // explicit type
 */
export function q<T extends Element = Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<Element>(selector);
  if (!el) throw new Error(`q: no element matches ${selector}`);
  return el as T;
}
