#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertCanonicalEdition } = require('./lib/edition-schema');
const { accessToken, getFullMessage } = require('./lib/gmail');
const { assertInventory, canonicalSourceMetadata, clean, extractHtmlSections, substantive } = require('./lib/money-stuff-source');
const {
  DEFAULT_GENERATION_STYLE, DEFAULT_TEXT_MODEL, assertNoReusableBoilerplate, clientFor, generateStory
} = require('./lib/openai-generation');

const root = path.resolve(__dirname, '..');
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

function resolveEditionSelection(selection, publishedIssues, canonicalEditionIds) {
  const requested = String(selection || '').trim();
  if (!requested) throw new Error('Edition selection must not be empty');
  const canonical = new Set(canonicalEditionIds);
  const issues = publishedIssues || [];
  const assertCanonical = issue => {
    if (!issue || !canonical.has(issue.editionId)) {
      throw new Error(`Requested edition does not exist in canonical repository data: ${issue && issue.editionId || 'unknown'}`);
    }
    return issue;
  };
  if (requested === 'all') {
    if (!issues.length) throw new Error('No currently published editions exist');
    return issues.map(assertCanonical);
  }

  const values = requested.split(',').map(value => value.trim());
  if (values.some(value => !value) || values.includes('all')) {
    throw new Error('Edition selection must be a comma-separated list of edition IDs/dates, or exactly "all"');
  }
  const selected = values.map(value => {
    const matches = issues.filter(issue => issue.editionId === value || issue.date === value);
    if (matches.length !== 1) throw new Error(`Requested edition is invalid, ambiguous, or not published: ${value}`);
    return assertCanonical(matches[0]);
  });
  if (new Set(selected.map(issue => issue.editionId)).size !== selected.length) {
    throw new Error('Edition selection contains duplicates');
  }
  return selected;
}

function locateSections(stories, sections) {
  const sourceSections = substantive(sections);
  const byHeading = new Map();
  for (const section of sourceSections) {
    const heading = clean(section.heading).toLowerCase();
    if (byHeading.has(heading)) throw new Error(`Canonical source has ambiguous section heading: ${heading}`);
    byHeading.set(heading, section);
  }
  const exact = stories.map(story => byHeading.get(clean(story.sourceSection).toLowerCase()));
  const aligned = stories.length === sourceSections.length && exact.every((section, index) => !section || section === sourceSections[index]);
  return stories.map((story, index) => {
    const section = exact[index] || (aligned ? sourceSections[index] : null);
    return section
      ? { section }
      : { error: new Error(`Canonical source section could not be matched unambiguously: ${story.sourceSection}`) };
  });
}

function elementaryChanged(story, elementary) {
  return JSON.stringify(story.adaptations.elementary) !== JSON.stringify(elementary);
}

function acceptElementaryCandidate({ accepted, generated, index, story, updated }) {
  const elementary = generated.adaptations.elementary;
  if (!elementaryChanged(story, elementary)) {
    throw new Error('generated Elementary adaptation was identical to existing content');
  }
  const candidate = structuredClone(story);
  candidate.adaptations.elementary = elementary;
  assertNoReusableBoilerplate([...accepted, candidate]);
  updated.stories[index].adaptations.elementary = elementary;
  accepted.push(candidate);
}

async function generateWithRetries({ client, model, section, validateCandidate, generate = generateStory }) {
  let validationError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const generated = (await generate({
        client, model, section, style: DEFAULT_GENERATION_STYLE,
        ...(validationError ? { priorValidationError: safeReason(validationError) } : {})
      })).value;
      validateCandidate(generated);
      return generated;
    } catch (error) {
      validationError = error;
      const reason = safeReason(error);
      const editorialFailure = /(?:Elementary|What happened|checklist|boilerplate|parsed money_stuff_story)/i.test(reason);
      if (!editorialFailure || /identical to existing content/i.test(reason)) throw error;
    }
  }
  throw validationError;
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
  const total = results.reduce((sum, item) => sum + item.total, 0);
  const failures = results.flatMap(item => item.failures.map(failure => ({ edition: item.editionId, ...failure })));
  const lines = [
    '## Historical Elementary rhyming backfill', '',
    `- Successfully regenerated **${successes} of ${total}** stories.`,
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
  const canonicalEditionIds = fs.readdirSync(path.join(root, 'data'))
    .filter(name => /^\d{4}-\d{2}-\d{2}-.+\.json$/.test(name))
    .map(name => name.replace(/\.json$/, ''));
  const issues = resolveEditionSelection(requiredEnv('EDITION_IDS', environment), state.processedIssues, canonicalEditionIds);
  if (issues.some(issue => !issue.gmailMessageId)) throw new Error('Every selected edition must have a recorded Gmail message ID');
  const editions = issues.map(issue => ({
    issue,
    file: path.join(root, 'data', `${issue.editionId}.json`),
    original: JSON.parse(fs.readFileSync(path.join(root, 'data', `${issue.editionId}.json`), 'utf8'))
  }));
  const total = editions.reduce((sum, item) => sum + item.original.stories.length, 0);

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
      const metadata = canonicalSourceMetadata(message, issue);
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
        if (sections[index].error) {
          failures.push({ story: story.sourceSection, reason: safeReason(sections[index].error) });
          continue;
        }
        try {
          const generated = await generateWithRetries({
            client, model, section: sections[index].section,
            validateCandidate(value) {
              if (!elementaryChanged(story, value.adaptations.elementary)) {
                throw new Error('generated Elementary adaptation was identical to existing content');
              }
              const candidate = structuredClone(story);
              candidate.adaptations.elementary = value.adaptations.elementary;
              assertNoReusableBoilerplate([...accepted, candidate]);
            }
          });
          // Assign before recording acceptance: success therefore always maps
          // to the edition object that is subsequently serialized.
          acceptElementaryCandidate({ accepted, generated, index, story, updated });
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
  console.log(`Historical backfill completed: ${accepted.length}/${total} Elementary adaptations regenerated; ${total - accepted.length} unchanged.`);
  return { succeeded: accepted.length, failed: total - accepted.length, results, summaryFile };
}

if (require.main === module) runBackfill().catch(error => {
  console.error(`Historical backfill failed: ${safeReason(error)}`);
  process.exitCode = 1;
});

module.exports = {
  acceptElementaryCandidate, assertOnlyElementaryChanged, elementaryChanged, generateWithRetries, locateSections,
  markdownSummary, resolveEditionSelection, runBackfill, safeReason
};
