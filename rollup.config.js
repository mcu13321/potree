import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
export default [
	{
		input: 'src/Potree.js',
		treeshake: false,
		plugins: [
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