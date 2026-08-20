#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertCanonicalEdition } = require('./lib/edition-schema');
const { accessToken, getFullMessage } = require('./lib/gmail');
const { assertInventory, canonicalSourceMetadata, clean, extractHtmlSections } = require('./lib/money-stuff-source');
const {
  DEFAULT_GENERATION_STYLE, DEFAULT_TEXT_MODEL, assertNoReusableBoilerplate, clientFor, generateStory
} = require('./lib/openai-generation');

const root = path.resolve(__dirname, '..');
const EXPECTED_TOTAL = 39;
const EDITION_IDS = [
  '2026-07-28-elevators-wont-repair-themselves',
  '2026-07-30-the-situation-deteriorated',
  '2026-08-03-hedgehog-hedge-fund',
  '2026-08-04-leveraged-etf-crash-hedging-etf',
  '2026-08-06-fake-spacex-stock-isnt-worth-as-much',
  '2026-08-10-the-situation-is-fine',
  '2026-08-11-pick-and-shovel-seller-financing',
  '2026-08-12-ai-backed-securities',
  '2026-08-13-bilateral-otc-goat-hedge'
];
const REVIEW_STORIES = [
  'Situational Awareness / fund blowup',
  'World Liberty',
  'leveraged ETF crash-put cliquet ETF',
  'AI data-center securitization',
  'Truth Social API'
];

function requiredEnv(name, environment = process.env) {
  const value = environment[name];
  if (!value) throw new Error(`Required secret ${name} is missing`);
  return value;
}

function safeReason(error) {
  return String(error && error.message || error || 'unknown failure').replace(/\s+/g, ' ').slice(0, 240);
}

function locateSections(stories, sections) {
  const byHeading = new Map();
  for (const section of sections) {
    const heading = clean(section.heading);
    if (byHeading.has(heading)) throw new Error(`Canonical source has ambiguous section heading: ${heading}`);
    byHeading.set(heading, section);
  }
  return stories.map(story => {
    const section = byHeading.get(clean(story.sourceSection));
    if (!section) throw new Error(`Canonical source section not found: ${story.sourceSection}`);
    return section;
  });
}

function assertOnlyElementaryChanged(before, after) {
  const scrub = edition => ({
    ...edition,
    stories: edition.stories.map(story => ({
      ...story,
      adaptations: { ...story.adaptations, elementary: '__MIGRATED_ELEMENTARY__' }
    }))
  });
  if (JSON.stringify(scrub(before)) !== JSON.stringify(scrub(after))) {
    throw new Error('Backfill changed canonical content outside Elementary adaptations');
  }
}

function markdownSummary(results) {
  const successes = results.reduce((sum, item) => sum + item.succeeded, 0);
  const failures = results.flatMap(item => item.failures.map(failure => ({ edition: item.editionId, ...failure })));
  const lines = [
    '## Historical Elementary rhyming backfill', '',
    `- Successfully regenerated **${successes} of ${EXPECTED_TOTAL}** stories.`,
    '- Canonical source: authenticated Gmail messages recorded for the published editions.',
    '- Generation: the production `generateStory` / `rhyming-picture-book` path and its hardened validators.',
    '- Preservation: only Elementary adaptation fields were replaced; other ages, checklists, images, provenance, and schema metadata were preserved.',
    '- Validation: per-story word count, `What happened?`, stock/meta-rhyme, source/entity fidelity, proper-name line-break, and cross-story reusable-boilerplate guards ran during generation.',
    '', '### Counts per edition', ''
  ];
  for (const item of results) lines.push(`- \`${item.editionId}\`: ${item.succeeded}/${item.total}`);
  lines.push('', '### Stories left unchanged', '');
  if (!failures.length) lines.push('- None.');
  else for (const failure of failures) lines.push(`- \`${failure.edition}\` / **${failure.story}** — ${failure.reason}`);
  lines.push('', '### Recommended close human review', '');
  for (const story of REVIEW_STORIES) lines.push(`- ${story}`);
  return `${lines.join('\n')}\n`;
}

async function runBackfill({ environment = process.env } = {}) {
  const state = JSON.parse(fs.readFileSync(path.join(root, 'data/publisher-state.json'), 'utf8'));
  const byEdition = new Map((state.processedIssues || []).map(issue => [issue.editionId, issue]));
  const issues = EDITION_IDS.map(id => byEdition.get(id));
  if (issues.some(issue => !issue || !issue.gmailMessageId)) {
    throw new Error('Expected nine published editions with recorded Gmail message IDs');
  }
  const editions = issues.map(issue => ({
    issue,
    file: path.join(root, 'data', `${issue.editionId}.json`),
    original: JSON.parse(fs.readFileSync(path.join(root, 'data', `${issue.editionId}.json`), 'utf8'))
  }));
  const total = editions.reduce((sum, item) => sum + item.original.stories.length, 0);
  if (total !== EXPECTED_TOTAL) throw new Error(`Expected ${EXPECTED_TOTAL} historical stories, found ${total}`);

  const token = await accessToken({
    clientId: requiredEnv('GMAIL_CLIENT_ID', environment),
    clientSecret: requiredEnv('GMAIL_CLIENT_SECRET', environment),
    refreshToken: requiredEnv('GMAIL_REFRESH_TOKEN', environment)
  });
  const client = clientFor(requiredEnv('OPENAI_API_KEY', environment));
  const model = environment.OPENAI_TEXT_MODEL || DEFAULT_TEXT_MODEL;
  const accepted = [];
  const results = [];

  for (const { issue, file, original } of editions) {
    const updated = structuredClone(original);
    const failures = [];
    let sections;
    try {
      const message = await getFullMessage({ id: issue.gmailMessageId, token });
      if (!message.html) throw new Error('canonical Gmail message has no complete HTML body');
      const metadata = canonicalSourceMetadata(message);
      if (metadata.date !== original.date || clean(metadata.title) !== clean(original.title)) {
        throw new Error('recorded Gmail message date/title does not match the canonical edition');
      }
      sections = locateSections(original.stories, assertInventory(extractHtmlSections(message.html)));
    } catch (error) {
      const reason = safeReason(error);
      for (const story of original.stories) failures.push({ story: story.sourceSection, reason });
    }

    if (sections) {
      for (const [index, story] of original.stories.entries()) {
        try {
          const generated = (await generateStory({
            client, model, section: sections[index], style: DEFAULT_GENERATION_STYLE
          })).value;
          // Validate cross-story output before accepting it. Including every
          // previously accepted story makes the PR #21 guard span editions.
          const candidate = structuredClone(story);
          candidate.adaptations.elementary = generated.adaptations.elementary;
          assertNoReusableBoilerplate([...accepted, candidate]);
          updated.stories[index].adaptations.elementary = generated.adaptations.elementary;
          accepted.push(candidate);
        } catch (error) {
          failures.push({ story: story.sourceSection, reason: safeReason(error) });
        }
      }
    }
    assertOnlyElementaryChanged(original, updated);
    assertCanonicalEdition(updated);
    fs.writeFileSync(file, `${JSON.stringify(updated, null, 2)}\n`);
    results.push({ editionId: original.id, total: original.stories.length, succeeded: original.stories.length - failures.length, failures });
  }

  const summary = markdownSummary(results);
  const summaryFile = environment.BACKFILL_SUMMARY_FILE || path.join(root, '.historical-backfill-summary.md');
  fs.writeFileSync(summaryFile, summary);
  if (environment.GITHUB_STEP_SUMMARY) fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, summary);
  console.log(`Historical backfill completed: ${accepted.length}/${EXPECTED_TOTAL} Elementary adaptations regenerated; ${EXPECTED_TOTAL - accepted.length} unchanged.`);
  return { succeeded: accepted.length, failed: EXPECTED_TOTAL - accepted.length, results, summaryFile };
}

if (require.main === module) runBackfill().catch(error => {
  console.error(`Historical backfill failed: ${safeReason(error)}`);
  process.exitCode = 1;
});

module.exports = { assertOnlyElementaryChanged, locateSections, markdownSummary, safeReason };
