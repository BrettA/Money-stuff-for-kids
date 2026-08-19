'use strict';

const { createHash } = require('node:crypto');
const { load } = require('cheerio');

const THINGS_HAPPEN = /^things\s+happen[.!?]?$/i;
const IGNORED_HEADINGS = /^(money stuff|view in browser|subscribe|manage preferences|advertisement)$/i;
const FORWARDED_SUBJECT = /^\s*(?:fwd?|fw)\s*:/i;
const FORWARDED_MARKER = /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/im;

function clean(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function canonicalTitle(subject) {
  let title = clean(subject);
  while (FORWARDED_SUBJECT.test(title)) title = clean(title.replace(FORWARDED_SUBJECT, ''));
  return clean(title.replace(/^money stuff\s*:\s*/i, ''));
}

function forwardedHeaders(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n');
  const marker = FORWARDED_MARKER.exec(source);
  if (!marker) return null;
  const headerLines = source.slice(marker.index + marker[0].length).split('\n').slice(0, 50);
  let date = '';
  let subject = '';
  for (const line of headerLines) {
    const match = line.match(/^\s*(date|subject)\s*:\s*(.*?)\s*$/i);
    if (match && match[1].toLowerCase() === 'date') date = match[2];
    if (match && match[1].toLowerCase() === 'subject') subject = match[2];
    if (date && subject) return { date, subject };
  }
  return null;
}

function dateOnly(value, description) {
  // Gmail renders forwarded dates with an "at" separator that ECMAScript's
  // date parser does not accept (for example, "Jul 30, 2026 at 2:00 PM").
  const parseable = typeof value === 'string' ? value.replace(/\s+at\s+/i, ' ') : value;
  const parsed = new Date(parseable);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${description} has an invalid date`);
  return parsed.toISOString().slice(0, 10);
}

function canonicalSourceMetadata(message) {
  const outerSubject = clean(message && message.subject);
  let date;
  let subject = outerSubject;
  if (FORWARDED_SUBJECT.test(outerSubject)) {
    const original = forwardedHeaders(message && message.text);
    if (!original) throw new Error('Forwarded Money Stuff message has no usable original Date and Subject headers');
    date = dateOnly(original.date, 'Forwarded Money Stuff message');
    subject = original.subject;
  } else {
    date = dateOnly(Number(message && message.internalDate), 'Gmail message');
  }
  const title = canonicalTitle(subject);
  if (!title) throw new Error('Money Stuff message has no usable newsletter title');
  return { date, title };
}

function extractHtmlSections(html) {
  const $ = load(html);
  $('script,style,noscript').remove();
  const all = $('body').find('*').toArray();
  const positions = new Map(all.map((node, index) => [node, index]));
  const headings = $('h1,h2,h3').toArray().filter(node => {
    const heading = clean($(node).text());
    return heading && !IGNORED_HEADINGS.test(heading);
  });
  return headings.map((node, index) => {
    const heading = clean($(node).text());
    const chunks = [];
    const start = positions.get(node);
    const end = index + 1 < headings.length ? positions.get(headings[index + 1]) : all.length;
    for (const candidate of all.slice(start + 1, end)) {
      const element = $(candidate);
      if (!element.is('p,li,blockquote') && !(element.is('div,td') && element.children().length === 0)) continue;
      const text = clean(element.text());
      if (text && chunks[chunks.length - 1] !== text) chunks.push(text);
    }
    return { heading, sourceText: chunks.join('\n\n').trim() };
  }).filter(section => section.sourceText.length >= 40 || THINGS_HAPPEN.test(section.heading));
}

function assertInventory(sections) {
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('No Money Stuff source sections were found');
  const normalized = new Set();
  for (const section of sections) {
    if (!section.heading || (!section.sourceText && !THINGS_HAPPEN.test(section.heading))) {
      throw new Error(`Source section is incomplete: ${section.heading || '(missing heading)'}`);
    }
    const key = clean(section.heading).toLowerCase();
    if (normalized.has(key)) throw new Error(`Duplicate source heading: ${section.heading}`);
    normalized.add(key);
  }
  const excluded = sections.filter(section => THINGS_HAPPEN.test(clean(section.heading)));
  if (excluded.length > 1) throw new Error('Source contains more than one Things happen section');
  return sections;
}

function sourceDigest(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function substantive(sections) {
  return sections.filter(section => !THINGS_HAPPEN.test(clean(section.heading)));
}

module.exports = {
  THINGS_HAPPEN, assertInventory, canonicalSourceMetadata, canonicalTitle, clean, extractHtmlSections,
  forwardedHeaders, sourceDigest, substantive
};
