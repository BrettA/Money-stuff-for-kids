'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result;
}

function stageAndValidate({ root, edition, images, outputDirectory }) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-worker-validation-'));
  fs.mkdirSync(path.join(staging, 'data'), { recursive: true });
  fs.copyFileSync(path.join(root, 'data/site-config.json'), path.join(staging, 'data/site-config.json'));
  fs.writeFileSync(path.join(staging, 'data', `${edition.id}.json`), `${JSON.stringify(edition, null, 2)}\n`);
  for (const image of images) {
    const target = path.join(staging, image.path.replace(/^\//, ''));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, image.bytes);
  }

  run('node', [path.join(root, 'scripts/validate-edition.js'), staging], { cwd: root });
  run('npm', ['run', 'publish', '--', '--root', staging], { cwd: root });
  run('npm', ['run', 'check', '--', '--root', staging], { cwd: root });

  const packageRoot = path.join(outputDirectory, 'package');
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'edition.json'), `${JSON.stringify(edition, null, 2)}\n`);
  for (const image of images) {
    const target = path.join(packageRoot, image.path.replace(/^\//, ''));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, image.bytes);
  }
  const archive = path.join(outputDirectory, `${edition.id}.zip`);
  run('zip', ['-X', '-q', '-r', archive, 'edition.json', 'images'], { cwd: packageRoot });
  const bytes = fs.readFileSync(archive);
  if (bytes.length > 25 * 1024 * 1024) throw new Error('Completed package exceeds 25 MiB');
  return { archive, sha256: createHash('sha256').update(bytes).digest('hex'), staging };
}

module.exports = { run, stageAndValidate };
