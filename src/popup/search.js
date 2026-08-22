// The search field and its results. Knows how to draw a match and hand it
// back; knows nothing about how the catalogue behind it was built.

// A result is one (account, creator, experience) triple. All three are drawn,
// because that is exactly what makes two experiences sharing a name tell
// themselves apart, and what warns that choosing this one changes account.
function drawResult(match, activeUserId) {
  const item = document.createElement('li');
  item.setAttribute('role', 'option');

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  if (match.imageUrl) avatar.style.backgroundImage = `url("${match.imageUrl}")`;

  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = match.name;

  const path = document.createElement('div');
  path.className = 'sub';
  path.textContent =
    match.userId === activeUserId
      ? match.creatorLabel
      : `${match.creatorLabel} · @${match.username}`;
  text.append(path);

  item.append(avatar, text);

  if (match.userId !== activeUserId) {
    const warning = document.createElement('span');
    warning.className = 'switches';
    warning.textContent = 'switches';
    warning.title = `Choosing this switches to @${match.username}`;
    item.append(warning);
  }

  return item;
}

export class Search {
  constructor(root, { onPick, onRefresh, onExpand }) {
    this.root = root;
    this.input = root.querySelector('input');
    this.results = root.querySelector('.list');
    this.refreshButton = root.querySelector('.refresh');
    this.onPick = onPick;
    // Called whenever this panel takes the floor, so the owner can put away
    // whatever else was open.
    this.onExpand = onExpand;
    this.matches = [];
    this.activeUserId = null;

    this.input.addEventListener('focus', () => this.onExpand?.());
    this.input.addEventListener('input', () => this.onQuery(this.input.value));
    this.input.addEventListener('keydown', (event) => this.onKey(event));
    this.refreshButton.addEventListener('click', onRefresh);
  }

  // Set by the owner: the search field only asks, it does not fetch.
  set finder(fn) {
    this._finder = fn;
  }

  onQuery(query) {
    this.matches = query.trim() ? this._finder(query) : [];
    this.results.textContent = '';

    for (const [index, match] of this.matches.entries()) {
      const item = drawResult(match, this.activeUserId);
      item.setAttribute('aria-selected', String(index === 0));
      item.addEventListener('click', () => this.pick(index));
      this.results.append(item);
    }

    if (query.trim() && this.matches.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'nothing by that name';
      this.results.append(empty);
    }

    const showing = Boolean(query.trim());
    if (showing) this.onExpand?.();
    this.root.classList.toggle('open', showing);
    this.highlighted = 0;
  }

  // Arrow keys and Enter, because a search field you have to reach for the
  // mouse to finish is a search field that saved you nothing.
  onKey(event) {
    if (event.key === 'Escape') {
      this.clear();
      return;
    }
    if (!this.matches.length) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.highlight((this.highlighted + step + this.matches.length) % this.matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.pick(this.highlighted);
    }
  }

  highlight(index) {
    this.highlighted = index;
    for (const [position, item] of [...this.results.children].entries()) {
      item.setAttribute('aria-selected', String(position === index));
    }
    this.results.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  pick(index) {
    const match = this.matches[index];
    if (!match) return;
    this.clear();
    this.onPick(match);
  }

  // Puts the results away without losing what was typed, for when something
  // else on the page needs the room.
  collapse() {
    this.root.classList.remove('open');
  }

  clear() {
    this.input.value = '';
    this.results.textContent = '';
    this.root.classList.remove('open');
    this.matches = [];
  }

  busy(text) {
    this.refreshButton.disabled = Boolean(text);
    this.refreshButton.classList.toggle('spinning', Boolean(text));
    this.input.placeholder = text || 'Search an experience';
  }
}
