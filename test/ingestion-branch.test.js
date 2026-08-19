const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const script = path.join(repo, 'scripts', 'prepare-ingestion-branch.sh');

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

test('retry resets only the deterministic ingestion branch to current main', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-branch-'));
  const remote = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', remote);
  git(root, 'init', '-b', 'main', seed);
  git(seed, 'config', 'user.name', 'Test');
  git(seed, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(seed, 'value'), 'main');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'main');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', 'origin', 'main');
  git(seed, 'switch', '-c', 'automated-edition/2026-08-20-retry');
  fs.writeFileSync(path.join(seed, 'value'), 'failed run');
  git(seed, 'commit', '-am', 'failed run');
  git(seed, 'push', 'origin', 'HEAD');
  git(seed, 'switch', '-c', 'unrelated');
  const unrelated = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'push', 'origin', 'HEAD');

  git(root, 'clone', remote, work);
  const output = path.join(root, 'outputs');
  const result = spawnSync(script, ['2026-08-20-retry'], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: output }
  });
  assert.equal(result.status, 0, result.stderr);
  const main = git(work, 'rev-parse', 'origin/main');
  assert.equal(git(root, '--git-dir', remote, 'rev-parse', 'refs/heads/automated-edition/2026-08-20-retry'), main);
  assert.equal(git(root, '--git-dir', remote, 'rev-parse', 'refs/heads/unrelated'), unrelated);
  assert.equal(git(work, 'branch', '--show-current'), 'automated-edition/2026-08-20-retry');
  assert.match(fs.readFileSync(output, 'utf8'), new RegExp(`push_lease=${main}`));
});

test('first attempt preserves an absent remote branch and emits an empty lease', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-branch-new-'));
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
  const output = path.join(root, 'outputs');
  const result = spawnSync(script, ['2026-08-20-first'], {
    cwd: work, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(spawnSync('git', ['--git-dir', remote, 'show-ref', '--verify', '--quiet', 'refs/heads/automated-edition/2026-08-20-first']).status, 0);
  assert.match(fs.readFileSync(output, 'utf8'), /push_lease=\n/);
});
