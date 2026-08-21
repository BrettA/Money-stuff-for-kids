const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function loadPage(storage) {
  const listeners = {};
  const button = {
    addEventListener(type, handler) { listeners[type] = handler; },
    focus() {}
  };
  const modal = { hidden: true, querySelector: () => button };
  const classes = new Set();
  const document = {
    body: {
      dataset: { publicAgeMode: 'single' },
      classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value)
      }
    },
    addEventListener(type, handler) { listeners[type] = handler; },
    querySelector(selector) {
      if (selector === '#welcomeModal') return modal;
      return null;
    }
  };
  vm.runInNewContext(app, { document, localStorage: storage, FormData, fetch });
  listeners.DOMContentLoaded();
  return { button, classes, listeners, modal };
}

test('first-visit modal dismisses and stays dismissed on the next page load', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const first = loadPage(storage);
  assert.equal(first.modal.hidden, false);
  assert(first.classes.has('modal-open'));
  first.listeners.click();
  assert.equal(first.modal.hidden, true);
  assert.equal(storage.getItem('msfk-welcome-dismissed'), 'true');
  assert.equal(loadPage(storage).modal.hidden, true);
});
