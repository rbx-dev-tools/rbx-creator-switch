// Light, dark, or whatever the system says.
//
// The third one is the native behaviour and costs nothing: `color-scheme:
// light dark` in the stylesheet already follows the OS. This module exists
// only for the two cases where someone wants to override it, and it remembers
// that choice because a preference asked for once should not be asked twice.

const STORAGE_KEY = 'theme';
const MODES = [
  ['auto', 'Auto'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

function apply(mode) {
  if (mode === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
}

export async function mountThemeToggle(container) {
  container.textContent = '';
  let stored;
  try {
    ({ [STORAGE_KEY]: stored } = await chrome.storage.local.get(STORAGE_KEY));
  } finally {
    // The stylesheet keeps the page invisible until this attribute lands, so
    // a stored theme is never seen arriving: the first paint is the right
    // one. It is set whatever happened to the read, since a popup that stays
    // blank over a storage error would be worse than one in the wrong theme.
    // Colour transitions are also gated on it, so the first paint is a paint
    // and not a fade from the browser's default.
    requestAnimationFrame(() => {
      document.documentElement.dataset.themeReady = '';
    });
  }
  let current = MODES.some(([mode]) => mode === stored) ? stored : 'auto';
  apply(current);

  const buttons = MODES.map(([mode, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = `${label} theme`;
    button.addEventListener('click', () => select(mode));
    container.append(button);
    return [mode, button];
  });

  function select(mode) {
    current = mode;
    apply(mode);
    for (const [candidate, button] of buttons) {
      const on = candidate === mode;
      button.setAttribute('aria-pressed', String(on));
      // The highlight is one element that slides under the chosen button
      // rather than a background each button shows or hides. The buttons are
      // not the same width, so the stylesheet is told where to put it.
      if (on) {
        container.style.setProperty('--thumb-x', `${button.offsetLeft}px`);
        container.style.setProperty('--thumb-w', `${button.offsetWidth}px`);
      }
    }
    chrome.storage.local.set({ [STORAGE_KEY]: mode });
  }

  select(current);
}
