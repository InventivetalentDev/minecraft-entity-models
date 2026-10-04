import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateModel } from './lib.js';

function git(cwd, args, { input, allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, input, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error((result.stderr || result.stdout || 'Git command failed.').trim().replace(/\s+/g, ' '));
  }
  return { ok: result.status === 0, output: result.stdout.trim() };
}

async function validateInput(input, version) {
  if (!(await lstat(input)).isDirectory()) throw new Error('Input must be a directory.');
  let models = 0;
  async function json(filename) {
    try {
      return JSON.parse(await readFile(filename, 'utf8'));
    } catch (error) {
      throw new Error(`${path.relative(input, filename)}: ${error.message}`);
    }
  }
  async function visit(directory, relative = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    const directories = [];
    const files = [];
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const parts = name.split('/');
        if (!/^[a-z0-9_.-]+$/.test(entry.name) || entry.name === '.git'
            || (parts.length === 2 && !['entity', 'block_entity'].includes(entry.name))) {
          throw new Error(`Unexpected directory: ${name}`);
        }
        directories.push(entry.name);
        await visit(filename, name);
      } else if (entry.isFile()) {
        if (entry.name === '_list.json') continue;
        files.push(entry.name);
        const data = await json(filename);
        if (name === 'version.json') {
          if (data?.id !== version) throw new Error('version.json does not match --version.');
          continue;
        }
        const match = /^([a-z0-9_.-]+)\/(entity|block_entity)\/([a-z0-9_./-]+)\.json$/.exec(name);
        if (!match) throw new Error(`Unexpected file: ${name}`);
        try {
          validateModel(data);
        } catch (error) {
          throw new Error(`${name}: ${error.message}`);
        }
        if (data.id !== `${match[1]}:${match[3]}`) throw new Error(`Model id does not match its path: ${name}`);
        models += 1;
      } else {
        throw new Error(`Input must contain only regular files and directories: ${name}`);
      }
    }
    const listing = await json(path.join(directory, '_list.json'));
    const expected = { directories: directories.sort(), files: files.sort() };
    if (!listing || JSON.stringify(listing.directories) !== JSON.stringify(expected.directories)
        || JSON.stringify(listing.files) !== JSON.stringify(expected.files)
        || Object.keys(listing).sort().join(',') !== 'directories,files') {
      throw new Error(`Directory listing does not match its contents: ${relative || '.'}/_list.json`);
    }
  }
  await visit(input);
  await readFile(path.join(input, 'version.json'));
  if (models === 0) throw new Error('Input contains no models.');
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--version', '--input'].includes(args[i]) || !args[i + 1] || options[args[i]]) {
      throw new Error('Usage: node tools/publish.js --version VERSION --input DIRECTORY');
    }
    options[args[i]] = args[i + 1];
  }
  const version = options['--version'];
  if (!version || !options['--input']) throw new Error('Usage: node tools/publish.js --version VERSION --input DIRECTORY');
  if (version === 'main' || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) {
    throw new Error('Version must be a valid version branch name other than main.');
  }
  git(process.cwd(), ['check-ref-format', '--branch', version]);
  const input = await realpath(options['--input']);
  await validateInput(input, version);
  const repository = git(process.cwd(), ['rev-parse', '--show-toplevel']).output;
  const existing = git(repository, ['show-ref', '--verify', '--quiet', `refs/heads/${version}`], { allowFailure: true }).ok;
  let start = version;
  if (!existing) {
    const head = git(repository, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    if (head.ok) {
      start = head.output;
    } else {
      const tree = git(repository, ['hash-object', '-w', '-t', 'tree', '--stdin'], { input: '' }).output;
      start = git(repository, ['commit-tree', tree, '-m', 'Initialize publication worktree']).output;
    }
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'minecraft-entity-models-publish-'));
  const worktree = path.join(temporary, 'worktree');
  let added = false;
  try {
    git(repository, existing ? ['worktree', 'add', worktree, version] : ['worktree', 'add', '--detach', worktree, start]);
    added = true;
    if (!existing) git(worktree, ['checkout', '--orphan', version]);
    for (const entry of await readdir(worktree)) {
      if (entry !== '.git') await rm(path.join(worktree, entry), { recursive: true, force: true });
    }
    await cp(input, worktree, { recursive: true });
    git(worktree, ['add', '--all', '--force']);
    const changed = !git(worktree, ['diff', '--cached', '--quiet'], { allowFailure: true }).ok;
    if (changed || !existing) git(worktree, ['commit', '-m', version]);
  } finally {
    if (added) git(repository, ['worktree', 'remove', '--force', worktree]);
    await rm(temporary, { recursive: true, force: true });
  }
  console.log(`git push origin ${version}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
