#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { isPlaceholderIllustrationAlt } = require('./lib/illustration-alt');

const projectRoot = path.resolve(__dirname, '..');
const PLACEHOLDER_PATH_PATTERN = /(?:todo|placeholder|replace[-_ ]?me|example|generic|sample|(?:^|[/_.-])(?:image|illustration|default|temp)(?=[/_.-]|$))/i;

function loadInputs(root) {
  const dataDir = path.join(root, 'data');
  const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'site-config.json'), 'utf8'));
  const files = fs.readdirSync(dataDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}-.+\.json$/.test(name))
    .sort();
  const editions = files.map(file => ({
    file,
    data: JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'))
  }));
  return { config, editions };
}

function validate(config, editionFiles, root) {
  const errors = [];
  const ages = config.ages.map(age => age.id);
  if (!['single', 'multi'].includes(config.publicAgeMode)) {
    errors.push('site-config.json: publicAgeMode must be "single" or "multi"');
  }
  if (config.publicAgeMode === 'single' && !ages.includes(publicAge(config))) {
    errors.push('site-config.json: singlePublicAge must name a configured age');
  }

  for (const { file, data: edition } of editionFiles) {
    const error = message => errors.push(`${file}: ${message}`);
    if (edition.schemaVersion !== 2) error('schemaVersion must be 2');
    if (!edition.id || `${edition.id}.json` !== file) error('id must match its filename');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(edition.date || '') || !edition.displayDate || !edition.title) {
      error('date, displayDate, and title are required');
    }
    if (!Array.isArray(edition.sourceSections) || edition.sourceSections.length === 0) {
      error('sourceSections must inventory every source section');
    }
    if (!Array.isArray(edition.stories) || edition.stories.length === 0) {
      error('stories must be a non-empty array');
      continue;
    }

    const substantiveSections = (edition.sourceSections || [])
      .filter(section => normalize(section) !== 'things happen');
    const storySections = edition.stories.map(story => story.sourceSection);
    for (const section of substantiveSections) {
      if (!storySections.includes(section)) error(`missing substantive source section: ${section}`);
    }
    for (const section of storySections) {
      if (!substantiveSections.includes(section)) error(`invented or unlisted source section: ${section}`);
    }

    const storyIds = new Set();
    const imagePaths = new Set();
    for (const [index, story] of edition.stories.entries()) {
      const label = `story ${index + 1}`;
      if (!story.id || storyIds.has(story.id)) error(`${label} needs a unique id`);
      storyIds.add(story.id);
      if (!story.sourceSection || normalize(story.sourceSection) === 'things happen') {
        error(`${label} needs a substantive sourceSection`);
      }

      validateIllustration(story.illustration, label, imagePaths, root, error);
      for (const age of ages) {
        const adaptation = story.adaptations && story.adaptations[age];
        if (!adaptation || !adaptation.title || !adaptation.lesson ||
            !Array.isArray(adaptation.paragraphs) || adaptation.paragraphs.length === 0 ||
            adaptation.paragraphs.some(paragraph => !String(paragraph).trim())) {
          error(`${label} needs complete ${age} copy`);
        }
      }

      const checklist = story.elementaryChecklist;
      if (!checklist || !Array.isArray(checklist.realPeople) || checklist.realPeople.length === 0 ||
          !Array.isArray(checklist.realCompanies) || checklist.realCompanies.length === 0 ||
          !checklist.financialMechanism || !checklist.centralJoke) {
        error(`${label} needs a complete elementaryChecklist`);
      }
    }
    if (JSON.stringify(edition).includes('TODO:')) error('replace all TODO placeholders before publishing');
  }
  return errors;
}

function validateIllustration(illustration, label, imagePaths, root, error) {
  if (!illustration || typeof illustration !== 'object') {
    error(`${label} needs an explicit illustration object`);
    return;
  }
  const src = typeof illustration.src === 'string' ? illustration.src.trim() : '';
  const alt = typeof illustration.alt === 'string' ? illustration.alt.trim() : '';
  if (!src || !src.startsWith('/') || PLACEHOLDER_PATH_PATTERN.test(src)) {
    error(`${label} needs a non-placeholder illustration.src`);
  }
  if (isPlaceholderIllustrationAlt(alt)) {
    error(`${label} needs non-placeholder illustration alt text`);
  }
  if (src && imagePaths.has(src)) error(`${label} duplicates illustration path ${src}`);
  imagePaths.add(src);
  if (src && src.startsWith('/') && !PLACEHOLDER_PATH_PATTERN.test(src) &&
      !fs.existsSync(path.join(root, src.slice(1)))) {
    error(`${label} illustration file does not exist: ${src}`);
  }
}

function buildOutputs(config, editions) {
  const sorted = [...editions].sort((a, b) => b.date.localeCompare(a.date));
  const site = {
    ...config,
    editions: sorted.map(edition => ({
      id: edition.id,
      date: edition.date,
      displayDate: edition.displayDate,
      title: edition.title,
      storyCount: edition.stories.length,
      href: `/editions/${edition.id}/`
    }))
  };
  const outputs = new Map();
  outputs.set('data/site.json', `${JSON.stringify(site, null, 2)}\n`);
  outputs.set('index.html', renderHome(config, sorted));
  for (const edition of sorted) {
    outputs.set(`editions/${edition.id}/index.html`, renderEdition(config, edition));
  }
  return outputs;
}

function isSingleAgeMode(config) {
  return config.publicAgeMode === 'single';
}

function publicAge(config) {
  return config.singlePublicAge || config.defaultAge;
}

function renderHeader(config, title, { showEditionsBackLink = false } = {}) {
  const agebar = isSingleAgeMode(config) ? '' : `
    <div class="agebar">
      <span class="age-label">READING AGE</span>
${config.ages.map(age =>
    `        <button class="age-pill" data-age="${escapeHtml(age.id)}">${escapeHtml(age.label)}</button>`
  ).join('\n')}
    </div>`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/styles.css">
  <script defer src="/app.js"></script>
</head>
<body data-public-age-mode="${isSingleAgeMode(config) ? 'single' : 'multi'}">
  <header${showEditionsBackLink ? ' class="edition-header"' : ''}>
    <a class="logo" href="/">MONEY STUFF <span>FOR KIDS</span></a>
${agebar}${showEditionsBackLink ? '\n    <a class="back" href="/">← Back to all editions</a>' : ''}
  </header>`;
}

function renderSignup(config) {
  if (isSingleAgeMode(config)) return `    <section class="newsletter" id="newsletter">
      <div class="eyebrow" style="color:#b9c2b8">MONEY STUFF FOR KIDS — BY EMAIL</div>
      <h2>Get the next edition.</h2>
      <p>We'll email you when a new Money Stuff for Kids edition is published.</p>
      <form id="signupForm" class="signup signup-single">
        <input required type="email" name="email" placeholder="you@example.com" autocomplete="email">
        <input type="hidden" name="agePreference" value="${escapeHtml(publicAge(config))}">
        <input type="hidden" name="action" value="subscribe">
        <input type="hidden" name="_subject" value="Money Stuff for Kids signup">
        <input type="hidden" name="_template" value="table">
        <input type="text" name="_honey" style="display:none">
        <button type="submit">Subscribe</button>
      </form>
      <div id="signupStatus" class="status"></div>
      <p class="form-note">Unsubscribe anytime.</p>
    </section>`;
  const options = config.ages.map(age =>
    `          <option value="${escapeHtml(age.id)}">${escapeHtml(age.label)}</option>`
  ).join('\n');
  return `    <section class="newsletter" id="newsletter">
      <div class="eyebrow" style="color:#b9c2b8">MONEY STUFF FOR KIDS — BY EMAIL</div>
      <h2>Get the next edition.</h2>
      <p>Choose an age and we'll email that version when a new Money Stuff for Kids edition is published.</p>
      <form id="signupForm" class="signup">
        <input required type="email" name="email" placeholder="you@example.com" autocomplete="email">
        <select required id="agePreference" name="agePreference">
${options}
        </select>
        <input type="hidden" name="action" value="subscribe">
        <input type="hidden" name="_subject" value="Money Stuff for Kids signup">
        <input type="hidden" name="_template" value="table">
        <input type="text" name="_honey" style="display:none">
        <button type="submit">Subscribe</button>
      </form>
      <div id="signupStatus" class="status"></div>
      <p class="form-note">Unsubscribe anytime.</p>
    </section>`;
}

function renderFooter() {
  return `    <footer>Independent educational prototype inspired by Matt Levine's Money Stuff. Bloomberg and Money Stuff are not affiliated with this project.</footer>
  </main>
</body>
</html>
`;
}

function renderHome(config, editions) {
  const cards = editions.map(edition => `      <a class="edition-card" href="/editions/${escapeHtml(edition.id)}/">
        <div class="eyebrow">${escapeHtml(edition.displayDate.toUpperCase())}</div>
        <h2>${escapeHtml(edition.title)}</h2>
      </a>`).join('\n');
  return `${renderHeader(config, config.name)}
  <main>
    <section>
      <div class="eyebrow">THE WORLD OF MONEY, MADE SIMPLE</div>
      <h1>Money Stuff.<br><em>But for kids.</em></h1>
      <p class="intro">${isSingleAgeMode(config)
    ? "Matt Levine's Money Stuff, retold for curious kids."
    : "Matt Levine's Money Stuff, retold for curious kids. Choose a reading level and dive in."}</p>
    </section>
    <h2 class="section-title">All editions</h2>
    <div class="edition-grid">
${cards}
    </div>
${renderSignup(config)}
${renderFooter()}`;
}

function renderEdition(config, edition) {
  const stories = edition.stories.map((story, index) => renderStory(config, story, index)).join('\n');
  return `${renderHeader(config, `${edition.title} — ${config.name}`, { showEditionsBackLink: true })}
  <main>
    <div class="eyebrow">${escapeHtml(edition.displayDate.toUpperCase())} · MONEY STUFF EDITION</div>
    <h1>${escapeHtml(edition.title)}</h1>
${isSingleAgeMode(config) ? '' : `    <p class="intro"><b class="current-age-label">${escapeHtml(config.ages.find(age => age.id === config.defaultAge)?.label || config.defaultAge)}</b> edition.</p>`}
${stories}
${renderSignup(config)}
${renderFooter()}`;
}

function renderStory(config, story, index) {
  const visibleAges = isSingleAgeMode(config)
    ? config.ages.filter(age => age.id === publicAge(config))
    : config.ages;
  const adaptations = visibleAges.map(age => {
    const adaptation = story.adaptations[age.id];
    const paragraphs = adaptation.paragraphs.map(paragraph => `          <p>${escapeHtml(paragraph)}</p>`).join('\n');
    const lesson = age.id === 'elementary' ? '' : `
          <div class="lesson"><b>THE MONEY IDEA</b><br>${escapeHtml(adaptation.lesson)}</div>`;
    const ageAttribute = isSingleAgeMode(config) ? '' : ` data-age-copy="${escapeHtml(age.id)}"`;
    return `        <div${ageAttribute}>
          <h2>${escapeHtml(adaptation.title)}</h2>
${paragraphs}${lesson}
        </div>`;
  }).join('\n');
  return `    <article class="story">
      <div class="art">
        <img src="${escapeHtml(story.illustration.src)}" alt="${escapeHtml(story.illustration.alt)}">
      </div>
      <div class="copy">
        <div class="num">STORY ${index + 1}</div>
        <div class="original">IN MATT'S ARTICLE: <b>${escapeHtml(story.sourceSection)}</b></div>
${adaptations}
      </div>
    </article>`;
}

function publish({ root = projectRoot, checkOnly = false } = {}) {
  const { config, editions } = loadInputs(root);
  const errors = validate(config, editions, root);
  if (errors.length) throw new Error(errors.map(error => `• ${error}`).join('\n'));
  const outputs = buildOutputs(config, editions.map(item => item.data));
  if (checkOnly) {
    const stale = [...outputs].filter(([name, content]) => {
      const target = path.join(root, name);
      return !fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content;
    }).map(([name]) => name);
    if (stale.length) throw new Error(`Generated files are stale:\n${stale.map(name => `• ${name}`).join('\n')}`);
  } else {
    for (const [name, content] of outputs) {
      const target = path.join(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  return editions.length;
}

function normalize(value) {
  return String(value).trim().toLowerCase();
}
function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

if (require.main === module) {
  try {
    const checkOnly = process.argv.includes('--check');
    const rootIndex = process.argv.indexOf('--root');
    const root = rootIndex === -1 ? projectRoot : path.resolve(process.argv[rootIndex + 1]);
    if (rootIndex !== -1 && !process.argv[rootIndex + 1]) throw new Error('--root requires a directory');
    const count = publish({ checkOnly, root });
    console.log(checkOnly
      ? `Validated ${count} editions; generated archive and pages are current.`
      : `Published ${count} editions and rebuilt the homepage/archive.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { buildOutputs, loadInputs, publish, validate };
