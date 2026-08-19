'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const workflow = path.join(repo, '.github', 'workflows', 'generate-money-stuff.yml');
const { assertMessageEligible, retryRequested } = require('../scripts/money-stuff-worker');

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

test('state workflow safely clears an empty orphan worktree', () => {
  const contents = fs.readFileSync(workflow, 'utf8');
  assert.match(contents, /git -C "\$STATE_WORKTREE" rm -rf --ignore-unmatch \./);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-empty-state-'));
  const source = path.join(root, 'source');
  const stateWorktree = path.join(root, 'automation-state');
  git(root, 'init', '-b', 'main', source);
  git(source, 'config', 'user.name', 'Test');
  git(source, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(source, 'main-file'), 'main');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'main');
  git(source, 'worktree', 'add', '--detach', stateWorktree, 'HEAD');
  git(stateWorktree, 'switch', '--orphan', 'automation-state');

  assert.equal(git(stateWorktree, 'ls-files'), '');
  git(stateWorktree, 'rm', '-rf', '--ignore-unmatch', '.');
  assert.equal(git(stateWorktree, 'status', '--short'), '');
});

test('manual retry input defaults off and requires an explicit message and submission', () => {
  const contents = fs.readFileSync(workflow, 'utf8');
  assert.match(contents, /admin_retry:[\s\S]*?default: false/);
  assert.match(contents, /if: \$\{\{ inputs\.admin_retry \}\}/);
  assert.match(contents, /ADMIN_RETRY_TOKEN: \$\{\{ inputs\.admin_retry && secrets\.ADMIN_RETRY_TOKEN \|\| '' \}\}/);
  assert.equal(retryRequested({ ADMIN_RETRY: 'false' }), false);
  const authorized = {
    ADMIN_RETRY: 'true', ADMIN_RETRY_TOKEN: 'admin-secret', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GMAIL_MESSAGE_ID: 'id', SUBMIT: 'true'
  };
  assert.throws(() => retryRequested({ ...authorized, GITHUB_EVENT_NAME: 'push' }), /workflow_dispatch/);
  assert.throws(() => retryRequested({ ...authorized, GMAIL_MESSAGE_ID: '' }), /Gmail message ID/);
  assert.throws(() => retryRequested({ ...authorized, SUBMIT: 'false' }), /submission/);
  assert.throws(() => retryRequested({ ...authorized, ADMIN_RETRY_TOKEN: '' }), /authorization/);
  assert.equal(retryRequested(authorized), true);
  assert.throws(() => retryRequested({
    ...authorized, ADMIN_RETRY: 'false', PREVIOUS_EDITION_ID: '2026-08-19-old-edition'
  }), /only with admin retry/);
  assert.equal(retryRequested({ ...authorized, PREVIOUS_EDITION_ID: '2026-08-19-old-edition' }), true);
  const submitted = { messages: { id: { submitted: true } } };
  assert.throws(() => assertMessageEligible(submitted, 'id', false), /already submitted/);
  assert.doesNotThrow(() => assertMessageEligible(submitted, 'id', true));
});

test('workflow exposes migration input only through the administrative retry path', () => {
  const contents = fs.readFileSync(workflow, 'utf8');
  assert.match(contents, /previous_edition_id:[\s\S]*?required: false/);
  assert.match(contents, /PREVIOUS_EDITION_ID: \$\{\{ inputs\.previous_edition_id \}\}/);
  assert.match(contents, /!inputs\.admin_retry && inputs\.previous_edition_id != ''/);
});
