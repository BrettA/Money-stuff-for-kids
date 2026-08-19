'use strict';

const { createHash } = require('node:crypto');
const { load } = require('cheerio');

const THINGS_HAPPEN = /^things\s+happen[.!?]?$/i;
const IGNORED_HEADINGS = /^(money stuff|view in browser|subscribe|manage preferences|advertisement)$/i;

function clean(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
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

module.exports = { THINGS_HAPPEN, assertInventory, clean, extractHtmlSections, sourceDigest, substantive };
