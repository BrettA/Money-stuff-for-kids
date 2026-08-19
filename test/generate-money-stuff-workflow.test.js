'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const workflow = path.join(repo, '.github', 'workflows', 'generate-money-stuff.yml');

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
