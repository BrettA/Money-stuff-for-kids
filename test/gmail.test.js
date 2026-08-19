'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectBodies, decodeBase64Url, htmlToText } = require('../scripts/lib/gmail');

const encoded = value => Buffer.from(value).toString('base64url');

test('decodes nested Gmail MIME bodies and attachment-backed HTML', async () => {
  const payload = {
    mimeType: 'multipart/mixed', parts: [{
      mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', body: { data: encoded('plain complete body') } },
        { mimeType: 'text/html', body: { attachmentId: 'html-body' } }
      ]
    }]
  };
  const fetchImpl = async url => {
    assert.match(url, /attachments\/html-body$/);
    return { ok: true, json: async () => ({ data: encoded('<h2>A Story</h2><p>Full body</p>') }) };
  };
  const bodies = await collectBodies(payload, 'message', 'token', fetchImpl);
  assert.deepEqual(bodies.text, ['plain complete body']);
  assert.match(bodies.html[0], /A Story/);
});

test('normalizes HTML without retaining scripts', () => {
  assert.equal(htmlToText('<h2>Story</h2><p>Hello&nbsp;there</p><script>bad()</script>'), 'Story\nHello there');
  assert.equal(decodeBase64Url(encoded('safe bytes')), 'safe bytes');
});
