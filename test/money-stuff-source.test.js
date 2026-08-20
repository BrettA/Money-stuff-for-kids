'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertInventory, canonicalSourceMetadata, extractHtmlSections, substantive
} = require('../scripts/lib/money-stuff-source');

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

test('uses the Gmail date and Bloomberg subject for a direct Money Stuff message', () => {
  assert.deepEqual(canonicalSourceMetadata({
    internalDate: String(Date.parse('2026-08-18T14:00:00Z')),
    subject: 'Money Stuff: Direct Newsletter Title',
    text: 'Newsletter body'
  }), { date: '2026-08-18', title: 'Direct Newsletter Title' });
});

test('uses original forwarded headers instead of the outer Gmail provenance', () => {
  const text = `A note from the person forwarding this.

---------- Forwarded message ---------
From: Bloomberg <noreply@news.bloomberg.com>
Date: Thu, Jul 30, 2026 at 2:00 PM
Subject: Money Stuff: The Situation Deteriorated
To: A Reader <reader@example.com>

The newsletter body starts here.`;
  assert.deepEqual(canonicalSourceMetadata({
    internalDate: String(Date.parse('2026-08-19T09:30:00Z')),
    subject: 'Fwd: Money Stuff: The Situation Deteriorated',
    text
  }), { date: '2026-07-30', title: 'The Situation Deteriorated' });
});

test('fails closed when a forwarded message lacks its original header block', () => {
  assert.throws(() => canonicalSourceMetadata({
    internalDate: String(Date.parse('2026-08-19T09:30:00Z')),
    subject: 'FW: Money Stuff: Missing Provenance',
    text: 'No forwarded header block here.'
  }), /original Date and Subject headers/);
});

test('uses recorded canonical provenance for a known historical forwarded message without headers', () => {
  assert.deepEqual(canonicalSourceMetadata({
    internalDate: String(Date.parse('2026-08-19T09:30:00Z')),
    subject: 'FW: Money Stuff: Fake SpaceX Stock Isn’t Worth as Much',
    text: 'Forwarding client omitted the original header block.'
  }, {
    gmailMessageId: '1a01810c1bddf3d7', date: '2026-08-06',
    title: 'Fake SpaceX Stock Isn’t Worth as Much'
  }), { date: '2026-08-06', title: 'Fake SpaceX Stock Isn’t Worth as Much' });
});
