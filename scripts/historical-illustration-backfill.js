#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertCanonicalEdition } = require('./lib/edition-schema');
const {
  DEFAULT_IMAGE_MODEL, canonicalStoryIllustrationPrompt, clientFor, generateImage
} = require('./lib/openai-generation');
const { resolveEditionSelection, safeReason } = require('./historical-rhyming-backfill');

const root = path.resolve(__dirname, '..');

function imageDestination(editionId, story) {
  const current = story.illustration.src;
  if (current.endsWith('.png')) return current;
  return `/images/${editionId}/${story.id}.png`;
}

function assertOnlyIllustrationPathsChanged(before, after) {
  const scrub = edition => ({ ...edition, stories: edition.stories.map(story => ({
    ...story, illustration: { ...story.illustration, src: '__BACKFILLED_IMAGE__' }
  })) });
  if (JSON.stringify(scrub(before)) !== JSON.stringify(scrub(after))) {
    throw new Error('Backfill changed canonical content outside illustration image paths');
  }
}

function markdownSummary(results) {
  const editions = results.length;
  const regenerated = results.reduce((sum, result) => sum + result.succeeded, 0);
  const failures = results.flatMap(result => result.failures.map(failure => ({ editionId: result.editionId, ...failure })));
  const lines = [
    '## Historical illustration backfill', '',
    `- Editions processed: **${editions}**`,
    `- Images regenerated: **${regenerated}**`,
    `- Failures left unchanged: **${failures.length}**`,
    '- Generation used the production image helper, current story-specific content prompt, current image model, and current illustration style.',
    '- Canonical story text, all age adaptations, provenance, illustration alt text, and unrelated schema fields were preserved.',
    '', '### Failures left unchanged', ''
  ];
  if (!failures.length) lines.push('- None.');
  else for (const failure of failures) lines.push(`- \`${failure.editionId}\` / **${failure.story}** — ${failure.reason}`);
  return `${lines.join('\n')}\n`;
}

async function runBackfill({ environment = process.env, generate = generateImage } = {}) {
  const state = JSON.parse(fs.readFileSync(path.join(root, 'data/publisher-state.json'), 'utf8'));
  const canonicalIds = fs.readdirSync(path.join(root, 'data'))
    .filter(name => /^\d{4}-\d{2}-\d{2}-.+\.json$/.test(name)).map(name => name.slice(0, -5));
  const issues = resolveEditionSelection(environment.EDITION_IDS, state.processedIssues, canonicalIds);
  if (!environment.OPENAI_API_KEY) throw new Error('Required secret OPENAI_API_KEY is missing');
  const client = clientFor(environment.OPENAI_API_KEY);
  const model = environment.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const results = [];

  for (const issue of issues) {
    const file = path.join(root, 'data', `${issue.editionId}.json`);
    const original = JSON.parse(fs.readFileSync(file, 'utf8'));
    const updated = structuredClone(original);
    const failures = [];
    let succeeded = 0;
    for (const [index, story] of original.stories.entries()) {
      try {
        const destination = imageDestination(original.id, story);
        const image = await generate({ client, model, prompt: canonicalStoryIllustrationPrompt(story) });
        const diskPath = path.join(root, destination.replace(/^\//, ''));
        fs.mkdirSync(path.dirname(diskPath), { recursive: true });
        fs.writeFileSync(diskPath, image.bytes);
        if (destination !== story.illustration.src) {
          const oldPath = path.join(root, story.illustration.src.replace(/^\//, ''));
          if (fs.existsSync(oldPath)) fs.rmSync(oldPath);
          updated.stories[index].illustration.src = destination;
        }
        succeeded += 1;
      } catch (error) {
        failures.push({ story: story.sourceSection, reason: safeReason(error) });
      }
    }
    assertOnlyIllustrationPathsChanged(original, updated);
    assertCanonicalEdition(updated);
    fs.writeFileSync(file, `${JSON.stringify(updated, null, 2)}\n`);
    results.push({ editionId: original.id, succeeded, failures });
  }
  const summary = markdownSummary(results);
  const summaryFile = environment.BACKFILL_SUMMARY_FILE || path.join(root, '.historical-illustration-backfill-summary.md');
  fs.writeFileSync(summaryFile, summary);
  if (environment.GITHUB_STEP_SUMMARY) fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, summary);
  console.log(`Historical illustration backfill completed: ${results.reduce((n, r) => n + r.succeeded, 0)} images regenerated.`);
  return { results, summaryFile };
}

if (require.main === module) runBackfill().catch(error => {
  console.error(`Historical illustration backfill failed: ${safeReason(error)}`);
  process.exitCode = 1;
});

module.exports = { assertOnlyIllustrationPathsChanged, imageDestination, markdownSummary, runBackfill };
