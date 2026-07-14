/**
 * Help pop-out - a non-modal slide-in reference panel, toggled by the
 * bottom-left "?" button. Coexists with the canvas and the detail panel
 * (opposite edges), so it does not take a modal lock or trap focus.
 */

export function initHelp(): void {
  const btn = document.getElementById('help-btn')!;
  const panel = document.getElementById('help-panel')!;
  const closeBtn = document.getElementById('help-close-btn')!;

  const isOpen = () => !panel.classList.contains('hidden');

  function open(): void {
    panel.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    closeBtn.focus();
  }

  function close(): void {
    panel.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', () => {
    if (isOpen()) { close(); btn.focus(); } else { open(); }
  });

  closeBtn.addEventListener('click', () => {
    close();
    btn.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      close();
      btn.focus();
    }
  });
}
