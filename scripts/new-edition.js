#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestPath = process.argv[2];
if (!manifestPath) fail('Usage: npm run new-edition -- path/to/edition-manifest.json');
const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.date || '') || !manifest.title || !Array.isArray(manifest.sections)) {
  fail('Manifest needs date (YYYY-MM-DD), title, and a sections array.');
}
const slug = `${manifest.date}-${slugify(manifest.title)}`;
const stories = manifest.sections
  .filter(section => normalize(section.heading) !== 'things happen')
  .map(section => ({
    id: section.id || slugify(section.heading),
    sourceSection: section.heading,
    illustration: { src: `/images/${slug}/${section.id || slugify(section.heading)}.webp`, alt: 'TODO: describe the story-specific illustration' },
    elementaryChecklist: {
      realPeople: ['TODO: names retained, or “none in source”'],
      realCompanies: ['TODO: companies retained, or “none in source”'],
      financialMechanism: 'TODO: name the mechanism that must survive the adaptation',
      centralJoke: 'TODO: state the source joke or absurdity that must survive'
    },
    adaptations: Object.fromEntries(['preschool', 'elementary', 'middle', 'high'].map(age => [age, {
      title: `TODO: ${age} title`,
      lesson: 'TODO: money idea',
      paragraphs: ['TODO: adaptation copy']
    }]))
  }));
const edition = {
  schemaVersion: 2,
  id: slug,
  date: manifest.date,
  displayDate: new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${manifest.date}T00:00:00Z`)),
  title: manifest.title,
  sourceSections: manifest.sections.map(section => section.heading),
  stories
};
const output = path.join(root, 'data', `${slug}.json`);
if (fs.existsSync(output)) fail(`${path.relative(root, output)} already exists.`);
fs.writeFileSync(output, `${JSON.stringify(edition, null, 2)}\n`);
console.log(`Created ${path.relative(root, output)} with ${stories.length} substantive stories.`);
console.log('Replace every TODO, then run npm run publish.');
function normalize(value) { return String(value).trim().toLowerCase(); }
function slugify(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function fail(message) { console.error(message); process.exit(1); }
