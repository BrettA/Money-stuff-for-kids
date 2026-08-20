'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  assertOnlyIllustrationPathsChanged, imageDestination, markdownSummary
} = require('../scripts/historical-illustration-backfill');
const {
  ILLUSTRATION_CONTENT_INSTRUCTIONS, finalImagePrompt, illustrationPreviewContentPrompt
} = require('../scripts/lib/openai-generation');
const { illustrationPreviewContentPrompt: previewPrompt } = require('../scripts/lib/illustration-preview');

const repo = path.resolve(__dirname, '..');

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

test('preserves an existing PNG path and migrates another image type predictably', () => {
  assert.equal(imageDestination('edition', {
    id: 'story', illustration: { src: '/custom/location/current.png' }
  }), '/custom/location/current.png');
  assert.equal(imageDestination('edition', {
    id: 'story', illustration: { src: '/images/edition/legacy.svg' }
  }), '/images/edition/story.png');
});

test('backfill and preview expose the same effective content and style prompt', () => {
  const edition = { id: 'edition' };
  const story = {
    id: 'story', illustration: { alt: 'A very specific approved scene. ' },
    adaptations: { elementary: { title: 'The Approved Story' } }
  };
  const expected = [
    ILLUSTRATION_CONTENT_INSTRUCTIONS,
    'Story context: The Approved Story.',
    'Scene to illustrate exactly: A very specific approved scene.'
  ].join('\n');
  assert.equal(illustrationPreviewContentPrompt(edition, story), expected);
  assert.equal(previewPrompt(edition, story), expected);
  assert.equal(finalImagePrompt(illustrationPreviewContentPrompt(edition, story)), finalImagePrompt(previewPrompt(edition, story)));
});

test('preservation guard allows only illustration src changes', () => {
  const before = { id: 'edition', source: { messageId: 'keep' }, stories: [{
    sourceSection: 'Story', illustration: { src: '/old.svg', alt: 'keep alt' },
    adaptations: { elementary: { title: 'Keep text' } }
  }] };
  const after = structuredClone(before);
  after.stories[0].illustration.src = '/new.png';
  assert.doesNotThrow(() => assertOnlyIllustrationPathsChanged(before, after));
  after.stories[0].adaptations.elementary.title = 'Changed';
  assert.throws(() => assertOnlyIllustrationPathsChanged(before, after), /outside illustration image paths/);
});

test('summary counts editions and successful images while reporting failures', () => {
  const summary = markdownSummary([
    { editionId: 'one', succeeded: 2, failures: [] },
    { editionId: 'two', succeeded: 1, failures: [{ story: 'Broken', reason: 'API unavailable' }] }
  ]);
  assert.match(summary, /Editions processed: \*\*2\*\*/);
  assert.match(summary, /Images regenerated: \*\*3\*\*/);
  assert.match(summary, /Failures left unchanged: \*\*1\*\*/);
  assert.match(summary, /`two` \/ \*\*Broken\*\* — API unavailable/);
});

test('branch preparation creates a new dedicated branch but refuses an existing remote branch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-illustration-branch-'));
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', remote);
  git(root, 'init', '-b', 'main', work);
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(work, 'value'), 'main');
  git(work, 'add', '.');
  git(work, 'commit', '-m', 'main');
  git(work, 'remote', 'add', 'origin', remote);
  git(work, 'push', 'origin', 'main');

  const script = path.join(repo, 'scripts', 'prepare-historical-illustration-branch.sh');
  let result = spawnSync(script, ['historical-illustration-backfill'], { cwd: work, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(work, 'branch', '--show-current'), 'historical-illustration-backfill');
  git(work, 'push', 'origin', 'HEAD');
  git(work, 'switch', 'main');
  git(work, 'branch', '-D', 'historical-illustration-backfill');
  result = spawnSync(script, ['historical-illustration-backfill'], { cwd: work, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to overwrite existing branch/);
  assert.equal(git(work, 'branch', '--show-current'), 'main');
});

test('workflow is manual-only, validates, commits assets, and opens one PR', () => {
  const workflow = fs.readFileSync(path.join(repo, '.github/workflows/historical-illustration-backfill.yml'), 'utf8');
  const triggers = workflow.slice(0, workflow.indexOf('\npermissions:'));
  assert.match(workflow, /^name: One-time historical illustration backfill$/m);
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(triggers, /schedule:|pull_request:|\bpush:/);
  assert.match(workflow, /scripts\/prepare-historical-illustration-branch\.sh/);
  assert.match(workflow, /git add data images editions index\.html/);
  for (const command of ['npm run publish', 'npm run check', 'npm test', 'git diff --check']) {
    assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal((workflow.match(/gh pr create/g) || []).length, 1);
});
