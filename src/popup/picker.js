// One dropdown: a button showing the current row, a list of rows to choose
// from. Knows about rows and clicks, nothing about Roblox.
//
// A row is { value, label, sub, imageUrl }. Native <select> cannot show an
// image, which is the whole reason this exists.

// The image is a nicety, so the frame keeps its box whether or not one arrives.
// A row that reflows when its picture lands is worse than a row without one.
function paint(target, row) {
  target.querySelector('.avatar').style.backgroundImage = row.imageUrl
    ? `url("${row.imageUrl}")`
    : '';

  const text = target.querySelector('.text');
  text.textContent = row.label;
  if (row.sub) {
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = row.sub;
    text.append(sub);
  }
}

export class Picker {
  // `group` is every picker on the page, so opening one can close the others.
  static group = [];

  // Anything else on the page that floats. A picker knows how to close its
  // siblings; it cannot know about the search panel, so the owner hooks that
  // up here rather than the two learning about each other.
  static onOpen = null;

  constructor(id, onPick) {
    this.root = document.getElementById(id);
    this.button = this.root.querySelector('.current');
    this.list = this.root.querySelector('.list');
    this.onPick = onPick;
    this._rows = [];
    this.value = null;

    this.button.addEventListener('click', () => this.open(!this.isOpen));
    this.button.addEventListener('keydown', (event) => this.onKey(event));
    Picker.group.push(this);
  }

  // A list you can only reach with the mouse is a list half the keyboard
  // cannot use. Arrows move the highlight, Enter takes it, Escape gives up.
  onKey(event) {
    if (event.key === 'Escape') {
      this.open(false);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.isOpen) {
        this.open(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const at = this._rows.findIndex((row) => row.value === this.highlighted);
      const next = (at + step + this._rows.length) % this._rows.length;
      this.highlight(this._rows[next].value);
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (!this.isOpen) return;
      event.preventDefault();
      const value = this.highlighted ?? this.value;
      this.select(value);
      this.onPick(value);
    }
  }

  // The row the keyboard is on, which is not yet the row that is chosen.
  highlight(value) {
    this.highlighted = value;
    for (const [index, item] of [...this.list.children].entries()) {
      // The rows and the list can disagree for a moment, and a highlight is
      // decoration: it must never be the reason a picker fails to open.
      const row = this._rows[index];
      if (!row) continue;
      const on = row.value === value;
      item.classList.toggle('highlighted', on);
      if (on) item.scrollIntoView({ block: 'nearest' });
    }
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  // Open state is a class, not the hidden attribute: the list stays in the DOM
  // so it can fade instead of blinking, and it is positioned out of flow so
  // opening it moves nothing and grows nothing.
  open(shouldOpen) {
    // One list at a time, or a long one covers the picker below it.
    if (shouldOpen) {
      for (const other of Picker.group) if (other !== this) other.open(false);
      Picker.onOpen?.(this);
      // Opening starts from what is chosen, so the first arrow moves one step
      // from there rather than jumping to the top of the list.
      this.highlight(this.value);
    }
    this.root.classList.toggle('open', shouldOpen);
    this.button.setAttribute('aria-expanded', String(shouldOpen));
  }

  // Keeps the current selection when the same value is still on offer, so a
  // background refresh does not move what the user just picked.
  fill(rows, emptyLabel) {
    const previous = this.value;
    this._rows = rows;
    this.list.innerHTML = '';
    this.open(false);
    this.button.disabled = rows.length === 0;

    if (rows.length === 0) {
      paint(this.button, { label: emptyLabel });
      this.value = null;
      return;
    }

    for (const row of rows) {
      const item = document.createElement('li');
      item.append(
        Object.assign(document.createElement('span'), { className: 'avatar' }),
        Object.assign(document.createElement('span'), { className: 'text' })
      );
      paint(item, row);
      item.addEventListener('click', () => {
        this.select(row.value);
        this.onPick(row.value);
      });
      this.list.append(item);
    }

    this.select(rows.some((r) => r.value === previous) ? previous : rows[0].value);
  }

  select(value) {
    this.value = value;
    const row = this._rows.find((r) => r.value === value);
    if (row) paint(this.button, row);
    for (const [index, item] of [...this.list.children].entries()) {
      item.setAttribute('aria-selected', String(this._rows[index].value === value));
    }
    this.open(false);
  }

  // Pictures arrive after the names, so they are written into the rows already
  // on screen rather than through a rebuild, which would drop the open state
  // and the scroll position for a cosmetic change.
  updateImages(urlByKey) {
    let changed = false;
    for (const [index, row] of this._rows.entries()) {
      const url = urlByKey[row.imageKey ?? row.value];
      if (!url || row.imageUrl === url) continue;
      row.imageUrl = url;
      changed = true;
      const item = this.list.children[index];
      if (item) item.querySelector('.avatar').style.backgroundImage = `url("${url}")`;
    }
    if (changed && this.selected) paint(this.button, this.selected);
    return changed;
  }

  // The rows currently on offer. The catalogue crawl walks them rather than
  // asking Roblox again for a creator list the picker already holds.
  get rows() {
    return this._rows;
  }

  get selected() {
    return this.rows.find((r) => r.value === this.value) || null;
  }
}
