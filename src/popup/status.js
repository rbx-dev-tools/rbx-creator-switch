// The one line at the bottom that says what is happening or what went wrong.

const line = document.getElementById('status');

export const status = {
  say(text) {
    line.textContent = text;
    line.className = '';
  },
  clear() {
    this.say('');
  },
  fail(error) {
    line.textContent = error.message || String(error);
    line.className = 'error';
  },
};

// Wraps an async action so a failure lands on the status line instead of the
// console, where a popup user would never look.
export const guard =
  (fn) =>
  (...args) =>
    fn(...args).catch((err) => status.fail(err));
