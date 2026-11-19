// Direct Rollup invocation cannot bypass release version allocation and manifest generation.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
if (!existsSync(resolve('.potree-build.lock'))) {
  throw new Error('Use npm run build (or gulp build) to create a complete versioned Potree distribution');
}
// Read only the package version into browser code, without adding a JSON plugin dependency.
const packageVersionPlugin = {
  name: 'potree-package-version',
  load(id) {
    if (id !== resolve('package.json')) return null;
    const {version} = JSON.parse(readFileSync(id, 'utf8'));
    return 'export default ' + JSON.stringify({version}) + ';';
  }
};
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
export default [
	{
		input: 'src/Potree.js',
		treeshake: false,
		plugins: [
			packageVersionPlugin,
			nodeResolve({
				browser: true,
				preferBuiltins: false
			}),
			commonjs({
				include: 'libs/konva/**',
				requireReturnsDefault: 'auto'
			})
		],
		output: {
			file: 'build/potree/potree.js',
			format: 'umd',
			name: 'Potree',
			sourcemap: true,
		}
	},{
		input: 'src/workers/BinaryDecoderWorker.js',
		output: {
			file: 'build/potree/workers/BinaryDecoderWorker.js',
			format: 'es',
			name: 'Potree',
			sourcemap: false
		}
	},{
		input: 'src/modules/loader/2.0/DecoderWorker.js',
		output: {
			file: 'build/potree/workers/2.0/DecoderWorker.js',
			format: 'es',
			name: 'Potree',
			sourcemap: false
		}
	},{
		input: 'src/modules/loader/2.0/DecoderWorker_brotli.js',
		output: {
			file: 'build/potree/workers/2.0/DecoderWorker_brotli.js',
			format: 'es',
			name: 'Potree',
			sourcemap: false
		}
	}
]