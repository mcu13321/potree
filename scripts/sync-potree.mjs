import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout } from 'node:timers/promises';

// Hash the complete file inventory, excluding the self-describing manifest.
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sharingViolation = (error) => process.platform === 'win32' && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code);

// Windows scanners can briefly hold directories immediately after a verified copy.
export async function renameDirectory(source, target) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(source, target);
    } catch (error) {
      if (!sharingViolation(error) || attempt >= 10) throw error;
      await setTimeout(200 * (attempt + 1));
    }
  }
}

export async function inventory(directory) {
  const files = [];
  async function visit(relative = '') {
    const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${name}`);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile() && name !== 'version.json') {
        const content = await fs.readFile(path.join(directory, name));
        files.push({ path: name, size: content.length, sha256: sha256(content) });
      } else if (!entry.isFile()) throw new Error(`Unsupported build entry: ${name}`);
    }
  }
  await visit();
  return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

// Reject symlinks in any existing path component before renames or recursive removal.
export async function assertPlainPath(value) {
  const absolute = path.resolve(value);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symbolic link path: ${current}`);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  return absolute;
}

// A sync destination owns only a dedicated Potree directory, never its enclosing project.
export async function validateTarget(source, target) {
  if (!path.isAbsolute(target)) throw new Error('The target must be an absolute Potree directory path');
  const sourcePath = await assertPlainPath(source);
  const targetPath = await assertPlainPath(target);
  const overlaps = (a, b) => a === b || (!path.relative(a, b).startsWith(`..${path.sep}`) && path.relative(a, b) !== '..' && !path.isAbsolute(path.relative(a, b)));
  if (overlaps(sourcePath, targetPath) || overlaps(targetPath, sourcePath)) throw new Error('Build and target directories must not overlap');
  if (path.basename(targetPath).toLowerCase() !== 'potree') throw new Error('The dedicated target directory must be named potree');
  for (const marker of ['.git', 'package.json', 'src']) {
    if (await fs.lstat(path.join(targetPath, marker)).then(() => true, (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    })) throw new Error(`The target looks like a source project: ${targetPath}`);
  }
  const exists = await fs.stat(targetPath).then((stat) => {
    if (!stat.isDirectory()) throw new Error('The target must be a directory');
    return true;
  }, (error) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (exists && (await fs.readdir(targetPath)).length) {
    // Accept existing legacy distributions only when both core files are present.
    for (const marker of ['potree.js', 'potree.css']) await fs.access(path.join(targetPath, marker));
    await inventory(targetPath);
  }
  return targetPath;
}

// Validate both the manifest digest and the exact file set before importing a build.
export async function verifyBuild(directory) {
  await assertPlainPath(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'version.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !Array.isArray(manifest.files)) {
    throw new Error('Unsupported Potree version manifest');
  }
  const files = await inventory(directory);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files) || sha256(JSON.stringify(files)) !== manifest.artifactSha256) {
    throw new Error(`Potree build checksum mismatch: ${directory}`);
  }
  for (const required of ['potree.js', 'potree.css', 'LICENSE', 'workers/2.0/DecoderWorker.js']) {
    if (!files.some((file) => file.path === required)) throw new Error(`Missing required build file: ${required}`);
  }
  return manifest;
}

// Remove only a checked child of a known parent, including transaction staging directories.
export async function removeChild(parent, child) {
  const absoluteParent = await assertPlainPath(parent);
  const absoluteChild = await assertPlainPath(child);
  if (path.dirname(absoluteChild) !== absoluteParent) throw new Error('Refusing to remove a directory outside its expected parent');
  await fs.rm(absoluteChild, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

// A running Windows dev server can hold a directory handle while still allowing file updates.
async function mirrorContents(source, target) {
  const previous = await inventory(target).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const next = new Set((await inventory(source)).map((file) => file.path));
  const hasRecord = (directory) => fs.access(path.join(directory, 'version.json')).then(() => true, (error) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (await hasRecord(target)) previous.push({ path: 'version.json' });
  if (await hasRecord(source)) next.add('version.json');
  await fs.cp(source, target, { recursive: true, force: true });
  for (const file of previous) {
    if (!next.has(file.path)) await fs.rm(path.join(target, file.path), { force: true });
  }
}

export async function syncBuild(source, target, { rename = renameDirectory } = {}) {
  const targetPath = await validateTarget(source, target);
  const manifest = await verifyBuild(source);
  const parent = path.dirname(targetPath);
  await fs.mkdir(parent, { recursive: true });
  const token = randomUUID();
  const staging = path.join(parent, `.potree-sync-${token}`);
  const backup = path.join(parent, `.potree-backup-${token}`);
  let savedPrevious = false;
  let copiedPrevious = false;
  let installed = false;
  try {
    await fs.cp(source, staging, { recursive: true, errorOnExist: true, force: false });
    await verifyBuild(staging);
    try {
      await rename(targetPath, backup);
      savedPrevious = true;
    } catch (error) {
      if (sharingViolation(error)) {
        // Preserve a verified backup before updating a directory that cannot be moved.
        await fs.cp(targetPath, backup, { recursive: true });
        if (JSON.stringify(await inventory(backup)) !== JSON.stringify(await inventory(targetPath))) {
          throw new Error('Previous Potree distribution backup checksum mismatch');
        }
        savedPrevious = true;
        copiedPrevious = true;
      } else if (error.code !== 'ENOENT') throw error;
    }
    if (copiedPrevious) {
      installed = true;
      await mirrorContents(staging, targetPath);
    } else {
      try {
        await rename(staging, targetPath);
        installed = true;
      } catch (error) {
        if (!sharingViolation(error)) throw error;
        installed = true;
        await mirrorContents(staging, targetPath);
      }
    }
    await verifyBuild(targetPath);
  } catch (error) {
    if (savedPrevious) {
      if (installed || copiedPrevious) await mirrorContents(backup, targetPath);
      else {
        try { await rename(backup, targetPath); }
        catch (restoreError) {
          if (!sharingViolation(restoreError)) throw restoreError;
          await mirrorContents(backup, targetPath);
        }
      }
    } else if (installed) await removeChild(parent, targetPath);
    throw error;
  } finally {
    await removeChild(parent, staging);
  }
  // Cleanup must not turn an already committed destination into a failed transaction.
  if (savedPrevious) await removeChild(parent, backup).catch((error) => console.warn(`Retained backup ${backup}: ${error.message}`));
  return manifest;
}

// Copying or verifying an existing artifact never allocates another version.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { source: { type: 'string' }, target: { type: 'string' }, check: { type: 'boolean' } } });
    const source = values.source ?? fileURLToPath(new URL('../build/potree', import.meta.url));
    if (!values.check && !values.target) throw new Error('Provide --target <absolute directory>, or --check to verify only');
    const manifest = values.check ? await verifyBuild(source) : await syncBuild(source, values.target);
    console.log(`Potree ${manifest.version} (${manifest.buildId}): ${values.check ? 'verified' : 'synchronized'}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
