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
  const { [STORAGE_KEY]: stored } = await chrome.storage.local.get(STORAGE_KEY);
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
      button.setAttribute('aria-pressed', String(candidate === mode));
    }
    chrome.storage.local.set({ [STORAGE_KEY]: mode });
  }

  select(current);
}
