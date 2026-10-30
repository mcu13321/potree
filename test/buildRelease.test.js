// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseBuildArgs, resolveBuildVersion, runBuild } from '../scripts/build.mjs';
import { inventory, syncBuild, validateTarget, verifyBuild } from '../scripts/sync-potree.mjs';

const fixtures = [];
// Real Git and Windows filesystem transactions need room for bounded sharing-violation retries.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });

// Real temporary repositories exercise HEAD-relative versions without touching developer history.
async function fixture(version = '1.9.0') {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'potree-release-test-'));
  fixtures.push(parent);
  const root = path.join(parent, 'source');
  const target = path.join(parent, 'host', 'potree');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'potree', version }, null, 2));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'potree', version, lockfileVersion: 3, packages: { '': { name: 'potree', version }, 'node_modules/example': { version: '8.0.0' } } }, null, 2));
  await fs.writeFile(path.join(root, 'source.txt'), 'original source\n');
  await fs.writeFile(path.join(root, '.gitignore'), '/build\n/version.json\n/.potree-build.lock\n');
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-qm', 'Baseline');
  const compile = async () => {
    const output = path.join(root, 'build', 'potree');
    for (const [name, data] of Object.entries({
      'potree.js': 'window.Potree = {};', 'potree.js.map': '{}', 'potree.css': 'body {}', LICENSE: 'license',
      'workers/2.0/DecoderWorker.js': 'self.onmessage = () => {};',
      'workers/laz-perf.wasm': Buffer.from([0, 97, 115, 109, 128, 255]),
      'lazylibs/sql.js/sql-wasm.wasm': Buffer.from([128, 254, 255]),
      'resources/icon.png': Buffer.from([137, 80, 78, 71, 255]), 'sidebar.html': '<main></main>',
    })) {
      await fs.mkdir(path.dirname(path.join(output, name)), { recursive: true });
      await fs.writeFile(path.join(output, name), data);
    }
  };
  return { root, target, compile, output: path.join(root, 'build', 'potree') };
}

afterEach(async () => {
  // Restrict recursive fixture cleanup to freshly allocated children of the OS temporary directory.
  for (const directory of fixtures.splice(0)) {
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('potree-release-test-')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('candidate version allocation', () => {
  // Clean rebuilds and dirty candidates are separate observable version decisions.
  it.each([
    ['1.8.0', '1.9.0', undefined, true, '1.9.0'],
    ['1.9.0', '1.9.0', undefined, false, '1.9.0'],
    ['1.9.0', '1.9.0', undefined, true, '1.9.1'],
    ['1.9.0', '1.9.1', undefined, true, '1.9.1'],
    ['1.9.9', '1.9.9', undefined, false, '1.9.9'],
    ['1.9.9', '1.9.9', undefined, true, '1.9.10'],
    ['1.9.1', '1.10.0', undefined, true, '1.10.0'],
    ['1.9.1', '1.9.1', '1.10.0', false, '1.10.0'],
    ['1.9.1', '1.9.2', '1.10.0', true, '1.10.0'],
  ])('resolves HEAD %s and working %s with override %s, dirty %s, to %s', (head, working, explicit, dirty, expectedVersion) => {
    expect(resolveBuildVersion(head, working, explicit, dirty)).toBe(expectedVersion);
  });
  it.each(['1.10.x', '01.9.0', '1.9', '1.9.0-dev', '-1.0.0'])('rejects incomplete or unsupported version %s', (value) => {
    expect(() => resolveBuildVersion('1.9.0', '1.9.0', value)).toThrow('complete numeric version');
  });
  it('parses documented npm and legacy Gulp options', () => {
    expect(parseBuildArgs(['--version', '1.10.0', '--target', '/host/potree'])).toEqual({ version: '1.10.0', target: '/host/potree' });
    expect(parseBuildArgs(['build', 'pack', '--target', '/host/potree'], true).target).toBe('/host/potree');
    expect(() => parseBuildArgs(['--targte', '/host/potree'])).toThrow();
  });
});

// Exercise the complete lifecycle through real Git state, including the user's clean rebuild.
it('retains committed versions when clean and advances only for subsequent source edits', async () => {
  const h = await fixture();
  const originalPackage = await fs.readFile(path.join(h.root, 'package.json'));
  const originalLock = await fs.readFile(path.join(h.root, 'package-lock.json'));
  for (let index = 0; index < 2; index++) {
    const clean = await runBuild(h);
    expect(clean.version).toBe('1.9.0');
    expect(clean.source.dirty).toBe(false);
    expect(git(h.root, 'status', '--porcelain').trim()).toBe('');
    expect(await fs.readFile(path.join(h.root, 'package.json'))).toEqual(originalPackage);
    expect(await fs.readFile(path.join(h.root, 'package-lock.json'))).toEqual(originalLock);
  }
  await fs.writeFile(path.join(h.root, 'source.txt'), 'first source change');
  const first = await runBuild(h);
  const second = await runBuild(h);
  expect(first.version).toBe('1.9.1');
  expect(second.version).toBe('1.9.1');
  expect(first.source.dirty).toBe(true);
  expect(second.source.dirty).toBe(true);
  const lock = JSON.parse(await fs.readFile(path.join(h.root, 'package-lock.json')));
  expect(lock.version).toBe('1.9.1');
  expect(lock.packages[''].version).toBe('1.9.1');
  expect(lock.packages['node_modules/example'].version).toBe('8.0.0');
  git(h.root, 'add', 'source.txt', 'package.json', 'package-lock.json');
  git(h.root, '-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-qm', 'Release candidate');
  const committed = await runBuild(h);
  expect(committed.version).toBe('1.9.1');
  expect(committed.source.dirty).toBe(false);
  expect(git(h.root, 'status', '--porcelain').trim()).toBe('');
  await fs.writeFile(path.join(h.root, 'source.txt'), 'second source change');
  expect((await runBuild(h)).version).toBe('1.9.2');
});

it.each(['unstaged', 'staged', 'untracked'])('allocates one candidate for %s source changes', async (state) => {
  const h = await fixture();
  await fs.writeFile(path.join(h.root, state === 'untracked' ? 'new-source.txt' : 'source.txt'), 'changed');
  if (state === 'staged') git(h.root, 'add', 'source.txt');
  const result = await runBuild(h);
  expect(result.version).toBe('1.9.1');
  expect(result.source.dirty).toBe(true);
});

it('ignores local build outputs and generated records when deciding whether sources changed', async () => {
  const h = await fixture();
  await fs.mkdir(path.join(h.root, 'build'));
  await fs.writeFile(path.join(h.root, 'build/ignored.txt'), 'generated');
  await fs.writeFile(path.join(h.root, 'version.json'), '{}');
  const result = await runBuild(h);
  expect(result.version).toBe('1.9.0');
  expect(result.source.dirty).toBe(false);
  expect(git(h.root, 'status', '--porcelain').trim()).toBe('');
});

it('accepts a manually edited package version and aligns the lock without another increment', async () => {
  const h = await fixture();
  const file = path.join(h.root, 'package.json');
  const current = JSON.parse(await fs.readFile(file));
  current.version = '1.10.0';
  await fs.writeFile(file, JSON.stringify(current));
  expect((await runBuild(h)).version).toBe('1.10.0');
  expect(JSON.parse(await fs.readFile(path.join(h.root, 'package-lock.json'))).version).toBe('1.10.0');
});

it('uses a manual major/minor override before commit and keeps all three records identical', async () => {
  const h = await fixture('1.8.0');
  const result = await runBuild({ ...h, version: '1.9.0' });
  expect(result.version).toBe('1.9.0');
  const local = await fs.readFile(path.join(h.root, 'version.json'), 'utf8');
  expect(await fs.readFile(path.join(h.output, 'version.json'), 'utf8')).toBe(local);
  expect(await fs.readFile(path.join(h.target, 'version.json'), 'utf8')).toBe(local);
  expect((await runBuild({ ...h, version: '1.10.0' })).version).toBe('1.10.0');
});

it('waits for async asset creation, preserves binary bytes, and removes stale target files', async () => {
  const h = await fixture();
  await runBuild(h);
  await fs.writeFile(path.join(h.target, 'obsolete.js'), 'stale');
  await fs.writeFile(path.join(h.output, 'stale-worker.js'), 'stale');
  await runBuild({ ...h, compile: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); await h.compile(); } });
  expect(await inventory(h.target)).toEqual(await inventory(h.output));
  expect(await fs.readFile(path.join(h.target, 'workers/laz-perf.wasm'))).toEqual(Buffer.from([0, 97, 115, 109, 128, 255]));
  expect(await fs.readdir(h.output)).not.toContain('stale-worker.js');
  expect(await fs.readdir(h.target)).not.toContain('obsolete.js');
});

it('rolls back auto versions, output and records when compilation fails', async () => {
  const h = await fixture();
  await runBuild(h);
  const previous = await fs.readFile(path.join(h.root, 'version.json'), 'utf8');
  const pkg = await fs.readFile(path.join(h.root, 'package.json'), 'utf8');
  await expect(runBuild({ ...h, version: '1.10.0', compile: async () => { await h.compile(); throw new Error('Compiler failed'); } })).rejects.toThrow('Compiler failed');
  expect(await fs.readFile(path.join(h.root, 'package.json'), 'utf8')).toBe(pkg);
  expect(await fs.readFile(path.join(h.root, 'version.json'), 'utf8')).toBe(previous);
  expect(await fs.readFile(path.join(h.target, 'version.json'), 'utf8')).toBe(previous);
  await verifyBuild(h.output);
  await expect(fs.access(path.join(h.root, '.potree-build.lock'))).rejects.toThrow();
});

it('rolls back when target verification fails and preserves the previous destination', async () => {
  const h = await fixture();
  await runBuild(h);
  const previous = await fs.readFile(path.join(h.root, 'version.json'), 'utf8');
  const compile = async () => {
    await h.compile();
    // Simulate a destination changing after preflight, before transaction installation.
    await fs.writeFile(path.join(h.target, 'package.json'), '{}');
  };
  await expect(runBuild({ ...h, version: '1.10.0', compile })).rejects.toThrow('source project');
  expect(await fs.readFile(path.join(h.root, 'version.json'), 'utf8')).toBe(previous);
  expect(await fs.readFile(path.join(h.target, 'version.json'), 'utf8')).toBe(previous);
  await verifyBuild(h.output);
});

it('refuses corrupted artifacts and dangerous targets without overwriting existing content', async () => {
  const h = await fixture();
  await runBuild(h);
  const previous = await fs.readFile(path.join(h.target, 'potree.js'), 'utf8');
  await fs.writeFile(path.join(h.output, 'potree.js'), 'corrupted');
  await expect(syncBuild(h.output, h.target)).rejects.toThrow('checksum mismatch');
  expect(await fs.readFile(path.join(h.target, 'potree.js'), 'utf8')).toBe(previous);
  await expect(validateTarget(h.output, h.root)).rejects.toThrow();
  await expect(validateTarget(h.output, h.output)).rejects.toThrow('overlap');
  await expect(validateTarget(h.output, path.dirname(h.target))).rejects.toThrow('named potree');
  await expect(validateTarget(h.output, 'relative/potree')).rejects.toThrow('absolute');
});

it('rejects concurrent builds and releases ownership after a successful build', async () => {
  const h = await fixture();
  let proceed;
  const waiting = new Promise((resolve) => { proceed = resolve; });
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const running = runBuild({ ...h, compile: async () => { entered(); await waiting; await h.compile(); } });
  await started;
  await expect(runBuild(h)).rejects.toThrow('Another Potree build');
  proceed();
  await running;
  expect((await runBuild(h)).version).toBe('1.9.0');
});

it('preserves a manually pending version when the first build fails', async () => {
  const h = await fixture('1.8.0');
  const file = path.join(h.root, 'package.json');
  const pending = JSON.parse(await fs.readFile(file));
  pending.version = '1.9.0';
  await fs.writeFile(file, JSON.stringify(pending));
  await expect(runBuild({ ...h, compile: async () => { throw new Error('First build failed'); } })).rejects.toThrow('First build failed');
  expect(JSON.parse(await fs.readFile(file)).version).toBe('1.9.0');
  await expect(fs.access(path.join(h.root, 'version.json'))).rejects.toThrow();
  await expect(fs.access(h.target)).rejects.toThrow();
});

it('rejects linked destinations and linked artifact contents', async () => {
  const h = await fixture();
  await runBuild(h);
  const alias = path.join(h.root, 'alias', 'potree');
  await fs.mkdir(path.dirname(alias), { recursive: true });
  await fs.symlink(h.target, alias, 'junction');
  await expect(validateTarget(h.output, alias)).rejects.toThrow('Symbolic link');
  await fs.symlink(h.target, path.join(h.output, 'linked'), 'junction');
  await expect(verifyBuild(h.output)).rejects.toThrow('Symbolic link');
});

it.runIf(process.platform === 'win32')('synchronizes a watched Windows directory when directory renames are unavailable', async () => {
  const h = await fixture();
  await runBuild(h);
  await fs.writeFile(path.join(h.target, 'obsolete.js'), 'stale');
  const locked = async () => { throw Object.assign(new Error('Directory is watched'), { code: 'EPERM' }); };
  await syncBuild(h.output, h.target, { rename: locked });
  expect(await inventory(h.target)).toEqual(await inventory(h.output));
  expect((await verifyBuild(h.target)).version).toBe('1.9.0');
});

it.runIf(process.platform === 'win32')('restores a watched directory if the staged files fail verification during fallback', async () => {
  const h = await fixture();
  await runBuild(h);
  const previous = await fs.readFile(path.join(h.target, 'version.json'), 'utf8');
  const locked = async () => {
    // Simulate staged-file corruption after its initial verification and before installation.
    const parent = path.dirname(h.target);
    const stage = (await fs.readdir(parent)).find((name) => name.startsWith('.potree-sync-'));
    await fs.writeFile(path.join(parent, stage, 'potree.js'), 'corrupted');
    throw Object.assign(new Error('Directory is watched'), { code: 'EPERM' });
  };
  await expect(syncBuild(h.output, h.target, { rename: locked })).rejects.toThrow('checksum mismatch');
  expect(await fs.readFile(path.join(h.target, 'version.json'), 'utf8')).toBe(previous);
  await verifyBuild(h.target);
});
