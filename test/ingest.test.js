const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const editionId = '2026-08-20-automated-test';

function story(src = `/images/${editionId}/alpha.svg`) {
  const ages = ['preschool', 'elementary', 'middle', 'high'];
  return {
    id: 'alpha', sourceSection: 'Alpha', illustration: { src, alt: 'A precise alpha diagram' },
    elementaryChecklist: { realPeople: ['none in source'], realCompanies: ['Example Co.'], financialMechanism: 'A mechanism', centralJoke: 'A joke' },
    adaptations: Object.fromEntries(ages.map(age => [age, { title: `${age} title`, lesson: 'A lesson', paragraphs: ['Finished copy.'] }]))
  };
}

function edition(overrides = {}) {
  return { schemaVersion: 2, id: editionId, date: '2026-08-20', displayDate: 'August 20, 2026', title: 'Automated test', sourceSections: ['Alpha', 'Things happen'], stories: [story()], ...overrides };
}

function makeZip(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-zip-'));
  const spec = path.join(dir, 'spec.json');
  const archive = path.join(dir, 'package.zip');
  fs.writeFileSync(spec, JSON.stringify(entries));
  const code = `import json,zipfile,sys\nentries=json.load(open(sys.argv[1]))\nwith zipfile.ZipFile(sys.argv[2],'w') as z:\n for e in entries:\n  i=zipfile.ZipInfo(e['name']); i.external_attr=e.get('attr',0); z.writestr(i,e.get('content',''))`;
  assert.equal(spawnSync('python3', ['-c', code, spec, archive]).status, 0);
  return archive;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-root-'));
  fs.mkdirSync(path.join(root, 'data'));
  fs.copyFileSync(path.join(repo, 'data/site-config.json'), path.join(root, 'data/site-config.json'));
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const file of ['publish.js', 'validate-edition.js']) fs.copyFileSync(path.join(repo, 'scripts', file), path.join(root, 'scripts', file));
  fs.mkdirSync(path.join(root, 'scripts/lib'));
  fs.copyFileSync(path.join(repo, 'scripts/lib/illustration-alt.js'), path.join(root, 'scripts/lib/illustration-alt.js'));
  return root;
}

function run(entries, root = fixture()) {
  return spawnSync('python3', [path.join(repo, 'scripts/ingest-package.py'), '--root', root, '--archive', makeZip(entries), '--edition-id', editionId], { encoding: 'utf8' });
}

function validEntries(data = edition()) {
  return [
    { name: 'edition.json', content: JSON.stringify(data) },
    { name: `images/${editionId}/alpha.svg`, content: '<svg xmlns="http://www.w3.org/2000/svg"/>' }
  ];
}

test('installs only a valid canonical edition and its referenced image', () => {
  const root = fixture();
  const result = run(validEntries(), root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data', `${editionId}.json`))).schemaVersion, 2);
  assert(fs.existsSync(path.join(root, 'images', editionId, 'alpha.svg')));
});

test('rejects schema mismatch and dispatch ID mismatch', () => {
  assert.notEqual(run(validEntries(edition({ schemaVersion: 1 }))).status, 0);
  assert.notEqual(run(validEntries(edition({ id: '2026-08-20-wrong' }))).status, 0);
});

test('rejects traversal, absolute paths, backslashes, symlinks, and duplicate members', () => {
  const attacks = [
    [...validEntries(), { name: '../escape', content: 'x' }],
    [...validEntries(), { name: '/absolute', content: 'x' }],
    [...validEntries(), { name: 'images\\escape.svg', content: 'x' }],
    [...validEntries(), { name: 'link', content: 'target', attr: (0o120777 * 65536) }],
    [...validEntries(), { name: 'edition.json', content: '{}' }]
  ];
  for (const entries of attacks) assert.notEqual(run(entries).status, 0);
});

test('rejects missing, extra, noncanonical, and unsupported image files', () => {
  assert.notEqual(run(validEntries().slice(0, 1)).status, 0);
  assert.notEqual(run([...validEntries(), { name: `images/${editionId}/extra.svg`, content: '<svg/>' }]).status, 0);
  assert.notEqual(run(validEntries(edition({ stories: [story('/images/another-edition/alpha.svg')] }))).status, 0);
  assert.notEqual(run(validEntries(edition({ stories: [story(`/images/${editionId}/alpha.exe`)] }))).status, 0);
});

test('uses publisher rules and leaves no files after failed validation', () => {
  const root = fixture();
  const invalid = edition({ sourceSections: ['Alpha', 'Missing', 'Things happen'] });
  const result = run(validEntries(invalid), root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing substantive source section/);
  assert(!fs.existsSync(path.join(root, 'data', `${editionId}.json`)));
});

test('refuses to overwrite an existing canonical edition or image', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'images', editionId), { recursive: true });
  fs.writeFileSync(path.join(root, 'images', editionId, 'alpha.svg'), 'existing');
  assert.notEqual(run(validEntries(), root).status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'images', editionId, 'alpha.svg'), 'utf8'), 'existing');
});
