import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import { transform } from 'esbuild';

// Keep generated scripts within both the affected WebView and the ES2020 grammar.
export const browserTargets = ['chrome83', 'es2020'];

export function transformBrowserScript(source, options = {}) {
  return transform(source, {
    target: browserTargets,
    charset: 'utf8',
    legalComments: 'inline',
    keepNames: true,
    ...options,
  });
}

// Rollup composes this map with its module maps to preserve original source locations.
export function browserCompatibilityPlugin() {
  return {
    name: 'potree-browser-compatibility',
    async renderChunk(source, chunk, output) {
      const result = await transformBrowserScript(source, {
        sourcefile: chunk.fileName,
        sourcemap: Boolean(output.sourcemap),
      });
      return { code: result.code, map: result.map || null };
    },
  };
}

// Concatenated workers bypass Rollup but must obey the same syntax target.
export async function transpileWorker(file) {
  const result = await transformBrowserScript(await readFile(file, 'utf8'), {
    sourcefile: path.basename(file),
  });
  await writeFile(file, result.code);
}

// Reject incompatible copied scripts before a release receives its manifest or is synchronized.
export async function verifyBrowserScripts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await verifyBrowserScripts(file);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      try {
        parse(await readFile(file, 'utf8'), { ecmaVersion: 2020 });
      } catch (error) {
        throw new Error(`Potree Chrome 83 syntax check failed for ${file}: ${error.message}`, { cause: error });
      }
    }
  }
}
