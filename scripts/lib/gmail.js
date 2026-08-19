'use strict';

const { load } = require('cheerio');

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me';

function decodeBase64Url(value) {
  return Buffer.from(String(value || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

async function accessToken({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const response = await fetchImpl(TOKEN_URL, { method: 'POST', body });
  if (!response.ok) throw new Error(`Gmail OAuth token exchange failed (${response.status})`);
  const result = await response.json();
  if (!result.access_token) throw new Error('Gmail OAuth response did not contain an access token');
  return result.access_token;
}

async function gmailRequest(path, token, fetchImpl = fetch) {
  const response = await fetchImpl(`${API_ROOT}${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Gmail API request failed (${response.status})`);
  return response.json();
}

async function findMessages({ token, query, fetchImpl = fetch, maxResults = 25 }) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const result = await gmailRequest(`/messages?${params}`, token, fetchImpl);
  return result.messages || [];
}

async function readPart(part, messageId, token, fetchImpl) {
  if (part.body && part.body.data) return decodeBase64Url(part.body.data);
  if (part.body && part.body.attachmentId) {
    const attachment = await gmailRequest(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
      token,
      fetchImpl
    );
    return decodeBase64Url(attachment.data);
  }
  return '';
}

async function collectBodies(part, messageId, token, fetchImpl, result = { html: [], text: [] }) {
  const mime = String(part.mimeType || '').toLowerCase();
  if (mime === 'text/html') result.html.push(await readPart(part, messageId, token, fetchImpl));
  if (mime === 'text/plain') result.text.push(await readPart(part, messageId, token, fetchImpl));
  for (const child of part.parts || []) await collectBodies(child, messageId, token, fetchImpl, result);
  return result;
}

function htmlToText(html) {
  const $ = load(html);
  $('script,style,noscript').remove();
  $('br').replaceWith('\n');
  $('p,div,li,h1,h2,h3,h4,blockquote').each((_, node) => $(node).append('\n'));
  return $.root().text().replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function headers(payload) {
  return Object.fromEntries((payload.headers || []).map(item => [String(item.name).toLowerCase(), item.value]));
}

async function getFullMessage({ id, token, fetchImpl = fetch }) {
  const message = await gmailRequest(`/messages/${encodeURIComponent(id)}?format=full`, token, fetchImpl);
  const bodies = await collectBodies(message.payload || {}, id, token, fetchImpl);
  const html = bodies.html.filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
  const plain = bodies.text.filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
  const text = html ? htmlToText(html) : plain.trim();
  if (!text) throw new Error('Selected Gmail message has no complete text or HTML body');
  const messageHeaders = headers(message.payload || {});
  return {
    id: message.id,
    threadId: message.threadId,
    internalDate: message.internalDate,
    rfcMessageId: messageHeaders['message-id'] || null,
    subject: messageHeaders.subject || '',
    from: messageHeaders.from || '',
    html,
    text
  };
}

module.exports = {
  API_ROOT, GMAIL_SCOPE, TOKEN_URL, accessToken, collectBodies, decodeBase64Url,
  findMessages, getFullMessage, htmlToText
};
