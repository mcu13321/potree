import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertPlainPath, inventory, removeChild, renameDirectory, sha256, syncBuild, validateTarget, verifyBuild } from './sync-potree.mjs';

// Preserve clean rebuilds; allocate a patch only when the source worktree has changes.
export function resolveBuildVersion(committed, current, explicit, dirty = false) {
  const valid = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  for (const value of [committed, current, ...(explicit === undefined ? [] : [explicit])]) {
    if (!valid.test(value)) throw new Error(`Expected a complete numeric version (major.minor.patch), received: ${value}`);
  }
  if (explicit !== undefined) return explicit;
  if (current !== committed) return current;
  if (!dirty) return committed;
  const [major, minor, patch] = committed.split('.');
  return `${major}.${minor}.${BigInt(patch) + 1n}`;
}

export function parseBuildArgs(args, allowPositionals = false) {
  const { values } = parseArgs({ args, allowPositionals, strict: !allowPositionals, options: {
    version: { type: 'string' }, target: { type: 'string' },
  } });
  return { version: values.version, target: values.target };
}

// Use the same awaited asset and Rollup tasks for npm, Gulp, and watch builds.
async function compilePotree(root) {
  const require = createRequire(path.join(root, 'package.json'));
  // A child owns all asset streams; rollback starts only after that process has fully exited.
  await new Promise((resolve, reject) => {
    const gulpCli = path.join(path.dirname(require.resolve('gulp')), 'bin', 'gulp.js');
    const child = spawn(process.execPath, [gulpCli, '_compile'], { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Potree compilation failed (${signal ?? code})`)));
  });
}

export async function runBuild({ root = fileURLToPath(new URL('..', import.meta.url)), version: explicit, target, compile } = {}) {
  root = await assertPlainPath(root);
  const buildParent = path.join(root, 'build');
  const output = path.join(buildParent, 'potree');
  await assertPlainPath(output);
  if (target) await validateTarget(output, target);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const lockPath = path.join(root, '.potree-build.lock');
  const lock = await fs.open(lockPath, 'wx').catch((error) => {
    if (error.code === 'EEXIST') throw new Error(`Another Potree build owns ${lockPath}; remove it only after confirming that build has stopped`);
    throw error;
  });
  const snapshots = new Map();
  let previousOutput;
  let replacedOutput = false;
  let completed = false;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    for (const name of ['package.json', 'package-lock.json', 'version.json']) {
      snapshots.set(name, await fs.readFile(path.join(root, name)).catch((error) => {
        if (error.code === 'ENOENT' && name === 'version.json') return null;
        throw error;
      }));
    }
    const packageInfo = JSON.parse(snapshots.get('package.json'));
    const committedVersion = JSON.parse(git('show', 'HEAD:package.json')).version;
    const source = {
      commit: git('rev-parse', 'HEAD'),
      branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
      dirty: git('status', '--porcelain', '--untracked-files=normal', '--', '.', ':!version.json', ':!.potree-build.lock') !== '',
      committedVersion,
    };
    const version = resolveBuildVersion(committedVersion, packageInfo.version, explicit, source.dirty);
    // Leave unchanged metadata byte-identical so formatting cannot dirty a clean rebuild.
    if (packageInfo.version !== version) {
      packageInfo.version = version;
      await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify(packageInfo, null, 2)}\n`);
    }
    const lockInfo = JSON.parse(snapshots.get('package-lock.json'));
    if (lockInfo.version !== version || (lockInfo.packages?.[''] && lockInfo.packages[''].version !== version)) {
      lockInfo.version = version;
      if (lockInfo.packages?.['']) lockInfo.packages[''].version = version;
      await fs.writeFile(path.join(root, 'package-lock.json'), `${JSON.stringify(lockInfo, null, 2)}\n`);
    }
    await fs.mkdir(buildParent, { recursive: true });
    previousOutput = path.join(buildParent, `.potree-previous-${randomUUID()}`);
    try {
      await renameDirectory(output, previousOutput);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      previousOutput = undefined;
    }
    replacedOutput = true;
    await (compile ?? (() => compilePotree(root)))();
    const files = await inventory(output);
    const artifactSha256 = sha256(JSON.stringify(files));
    const manifest = {
      schemaVersion: 1,
      version,
      buildId: `${version}-${source.commit.slice(0, 12)}-${artifactSha256.slice(0, 16)}`,
      builtAt: new Date().toISOString(),
      source,
      nodeVersion: process.version,
      lockfileSha256: sha256(await fs.readFile(path.join(root, 'package-lock.json'))),
      artifactSha256,
      files,
    };
    const record = `${JSON.stringify(manifest, null, 2)}\n`;
    await fs.writeFile(path.join(output, 'version.json'), record);
    await verifyBuild(output);
    await fs.writeFile(path.join(root, 'version.json'), record);
    if (target) await syncBuild(output, target);
    completed = true;
    console.log(`Potree ${version} (${manifest.buildId}) built${target ? ` and synchronized to ${target}` : ''}`);
    return manifest;
  } finally {
    try {
      if (!completed) {
      // A failed build or import must leave the prior package version and local artifact intact.
      if (replacedOutput) {
        await removeChild(buildParent, output);
        if (previousOutput) await renameDirectory(previousOutput, output);
      }
      for (const [name, content] of snapshots) {
        if (content === null) await fs.rm(path.join(root, name), { force: true });
        else await fs.writeFile(path.join(root, name), content);
      }
      } else if (previousOutput) {
        await removeChild(buildParent, previousOutput).catch((error) => console.warn(`Retained previous build ${previousOutput}: ${error.message}`));
      }
    } finally {
      // Ownership must be released even when restoring a previous file fails.
      await lock.close();
      await fs.rm(lockPath, { force: true });
    }
  }
}

// This CLI is shared by direct callers and outer-project package scripts.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await runBuild(parseBuildArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
