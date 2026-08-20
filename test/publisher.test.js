const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadInputs, publish, validate } = require('../scripts/publish');

const config = {
  name: 'Money Stuff for Kids',
  publicAgeMode: 'single',
  singlePublicAge: 'elementary',
  defaultAge: 'elementary',
  ages: [
    { id: 'preschool', label: 'Preschool' },
    { id: 'elementary', label: 'Elementary School' },
    { id: 'middle', label: 'Middle School' },
    { id: 'high', label: 'High School' }
  ]
};

function story(id = 'alpha', section = 'Alpha', src = '/images/test/alpha.svg') {
  return {
    id,
    sourceSection: section,
    illustration: { src, alt: `A specific illustration for ${section}` },
    elementaryChecklist: {
      realPeople: ['none in source'],
      realCompanies: ['Example Co.'],
      financialMechanism: 'A specific mechanism',
      centralJoke: 'A specific joke'
    },
    adaptations: Object.fromEntries(config.ages.map(age => [age.id, {
      title: `${age.label} title`,
      lesson: 'A money idea',
      paragraphs: ['Complete story copy.']
    }]))
  };
}

function edition(stories = [story()], sourceSections = ['Alpha', 'Things happen']) {
  return {
    schemaVersion: 2,
    id: '2026-08-20-test',
    date: '2026-08-20',
    displayDate: 'August 20, 2026',
    title: 'Test',
    sourceSections,
    stories
  };
}

function errorsFor(data, root = process.cwd()) {
  return validate(config, [{ file: `${data.id}.json`, data }], root);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-publisher-'));
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'images/test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'images/test/alpha.svg'), '<svg/>');
  fs.writeFileSync(path.join(root, 'data/site-config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(root, 'data/2026-08-20-test.json'), JSON.stringify(edition()));
  return root;
}

test('rejects an omitted substantive source section but ignores Things happen', () => {
  const errors = errorsFor(edition([story()], ['Alpha', 'Missing section', 'Things happen']));
  assert(errors.some(error => error.includes('missing substantive source section: Missing section')));
  assert(!errors.some(error => error.includes('missing substantive source section: Things happen')));
});

test('rejects missing copy for every supported age', () => {
  for (const age of config.ages) {
    const candidate = story();
    delete candidate.adaptations[age.id];
    assert(errorsFor(edition([candidate])).some(error => error.includes(`complete ${age.id} copy`)));
  }
});

test('rejects a missing explicit illustration object', () => {
  const candidate = story();
  delete candidate.illustration;
  assert(errorsFor(edition([candidate])).some(error => error.includes('explicit illustration object')));
});

test('rejects placeholder image paths and alt text', () => {
  for (const illustration of [
    { src: '/images/placeholder.svg', alt: 'Specific art' },
    { src: '/images/specific.svg', alt: 'Generic image' }
  ]) {
    const candidate = story();
    candidate.illustration = illustration;
    assert(errorsFor(edition([candidate])).some(error => error.includes('non-placeholder')));
  }
});

test('rejects an illustration path whose image file is missing', () => {
  const candidate = story();
  candidate.illustration.src = '/images/does-not-exist.svg';
  assert(errorsFor(edition([candidate])).some(error => error.includes('illustration file does not exist')));
});

test('rejects known generic final image filenames', () => {
  const candidate = story();
  candidate.illustration.src = '/images/image.svg';
  assert(errorsFor(edition([candidate])).some(error => error.includes('non-placeholder illustration.src')));
});

test('rejects duplicate image paths within an edition', () => {
  const stories = [story(), story('beta', 'Beta', '/images/test/alpha.svg')];
  assert(errorsFor(edition(stories, ['Alpha', 'Beta', 'Things happen']))
    .some(error => error.includes('duplicates illustration path')));
});

test('only dated edition JSON files are loaded, never the example manifest', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'data/edition-manifest.json'), JSON.stringify({ title: 'Example' }));
  assert.equal(loadInputs(root).editions.length, 1);
});

test('rebuilds deleted generated files from edition data and static config', () => {
  const root = fixture();
  publish({ root });
  const first = {
    site: fs.readFileSync(path.join(root, 'data/site.json'), 'utf8'),
    home: fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
    edition: fs.readFileSync(path.join(root, 'editions/2026-08-20-test/index.html'), 'utf8')
  };
  fs.rmSync(path.join(root, 'data/site.json'));
  fs.rmSync(path.join(root, 'index.html'));
  fs.rmSync(path.join(root, 'editions'), { recursive: true });
  publish({ root });
  assert.equal(fs.readFileSync(path.join(root, 'data/site.json'), 'utf8'), first.site);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), first.home);
  assert.equal(fs.readFileSync(path.join(root, 'editions/2026-08-20-test/index.html'), 'utf8'), first.edition);
});

test('publishing twice is deterministic and renders images without Elementary lesson boxes', () => {
  const root = fixture();
  publish({ root });
  const target = path.join(root, 'editions/2026-08-20-test/index.html');
  const first = fs.readFileSync(target, 'utf8');
  publish({ root });
  assert.equal(fs.readFileSync(target, 'utf8'), first);
  assert.match(first, /<img src="\/images\/test\/alpha\.svg" alt="A specific illustration for Alpha">/);
  assert.doesNotMatch(first, /class="lesson"/);
  assert(first.split('\n').length > 50, 'generated HTML should be human-readable');
});

test('single public mode renders only elementary copy and no age-band UI', () => {
  const root = fixture();
  publish({ root });
  const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'editions/2026-08-20-test/index.html'), 'utf8');
  assert.match(page, /Elementary School title/);
  assert.doesNotMatch(page, /Preschool title|Middle School title|High School title/);
  assert.doesNotMatch(`${home}${page}`, /READING AGE|Elementary School edition|Choose a reading level/);
  assert.match(page, /<header class="edition-header">[\s\S]*<a class="back" href="\/">← Back to all editions<\/a>[\s\S]*<\/header>/);
  assert.doesNotMatch(home, /class="back"/);
  assert.doesNotMatch(`${home}${page}`, /class="age-pill"|data-age-copy/);
  assert.match(home, /name="agePreference" value="elementary"/);
});

test('multi-age mode retains the selector and every adaptation', () => {
  const root = fixture();
  const multiAgeConfig = { ...config, publicAgeMode: 'multi' };
  fs.writeFileSync(path.join(root, 'data/site-config.json'), JSON.stringify(multiAgeConfig));
  publish({ root });
  const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'editions/2026-08-20-test/index.html'), 'utf8');
  assert.match(home, /READING AGE/);
  for (const age of config.ages) {
    assert.match(home, new RegExp(`data-age="${age.id}"`));
    assert.match(page, new RegExp(`data-age-copy="${age.id}"`));
    assert.match(page, new RegExp(`${age.label} title`));
  }
  assert.match(page, /Elementary School<\/b> edition/);
});

test('canonical stories reference existing illustrations that publishing renders', () => {
  const projectRoot = path.join(__dirname, '..');
  const { config: canonicalConfig, editions } = loadInputs(projectRoot);
  assert.deepEqual(validate(canonicalConfig, editions, projectRoot), []);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-canonical-publisher-'));
  fs.cpSync(path.join(projectRoot, 'data'), path.join(root, 'data'), { recursive: true });

  for (const { data: canonicalEdition } of editions) {
    for (const canonicalStory of canonicalEdition.stories) {
      const illustrationPath = canonicalStory.illustration.src;
      assert(illustrationPath.startsWith('/'), `invalid illustration path: ${illustrationPath}`);
      assert(fs.existsSync(path.join(projectRoot, illustrationPath.slice(1))), `missing ${illustrationPath}`);

      const target = path.join(root, illustrationPath.slice(1));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(projectRoot, illustrationPath.slice(1)), target);
    }
  }

  publish({ root });
  for (const { data: canonicalEdition } of editions) {
    const page = fs.readFileSync(path.join(root, 'editions', canonicalEdition.id, 'index.html'), 'utf8');
    for (const canonicalStory of canonicalEdition.stories) {
      assert(page.includes(`<img src="${canonicalStory.illustration.src}"`));
    }
  }
});
