'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertInventory, extractHtmlSections, substantive } = require('../scripts/lib/money-stuff-source');

test('inventories source headings in order and excludes only Things happen from stories', () => {
  const html = `<html><body>
    <h2>The Real Deal</h2><p>A real company made a real financial deal with enough source detail to adapt faithfully.</p>
    <h2>Another Story</h2><p>A named person did something financially strange and the mechanism matters to the joke.</p>
    <h2>Things happen</h2><p>Links links links.</p>
  </body></html>`;
  const sections = assertInventory(extractHtmlSections(html));
  assert.deepEqual(sections.map(item => item.heading), ['The Real Deal', 'Another Story', 'Things happen']);
  assert.deepEqual(substantive(sections).map(item => item.heading), ['The Real Deal', 'Another Story']);
});

test('fails closed for an empty or duplicate inventory', () => {
  assert.throws(() => assertInventory([]), /No Money Stuff/);
  assert.throws(() => assertInventory([
    { heading: 'Same', sourceText: 'one' }, { heading: ' same ', sourceText: 'two' }
  ]), /Duplicate/);
});
