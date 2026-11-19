
const path = require('path');
const gulp = require('gulp');
// Await child-process failures and every binary-preserving asset pipeline.
const {execFile} = require('node:child_process');
const {pipeline} = require('node:stream/promises');
const {promisify} = require('node:util');
const execFileAsync = promisify(execFile);

const fs = require("fs");
const fsp = fs.promises;
const concat = require('gulp-concat');
const connect = require('gulp-connect');
const {watch} = gulp;

const {createExamplesPage} = require("./src/tools/create_potree_page");
const {createGithubPage} = require("./src/tools/create_github_page");
const {createIconsPage} = require("./src/tools/create_icons_page");


let paths = {
	laslaz: [
		"build/workers/laslaz-worker.js",
		"build/workers/lasdecoder-worker.js",
	],
	html: [
		"src/viewer/potree.css",
		"src/viewer/sidebar.html",
		"src/viewer/profile.html"
	],
	resources: [
		"resources/**/*"
	]
};

let workers = {
	"LASLAZWorker": [
		"libs/plasio/workers/laz-perf.js",
		"libs/plasio/workers/laz-loader-worker.js"
	],
	"LASDecoderWorker": [
		"src/workers/LASDecoderWorker.js"
	],
	"EptLaszipDecoderWorker": [
		"libs/copc/index.js",
		"src/workers/EptLaszipDecoderWorker.js",
	],
	"EptBinaryDecoderWorker": [
		"libs/ept/ParseBuffer.js",
		"src/workers/EptBinaryDecoderWorker.js"
	],
	"EptZstandardDecoderWorker": [
		"src/workers/EptZstandardDecoder_preamble.js",
		'libs/zstd-codec/bundle.js',
		"libs/ept/ParseBuffer.js",
		"src/workers/EptZstandardDecoderWorker.js"
	]
};

// these libs are lazily loaded
// in order for the lazy loader to find them, independent of the path of the html file,
// we package them together with potree
let lazyLibs = {
	"geopackage": "libs/geopackage",
	"sql.js": "libs/sql.js"
};

let shaders = [
	"src/materials/shaders/pointcloud.vs",
	"src/materials/shaders/pointcloud.fs",
	"src/materials/shaders/pointcloud_sm.vs",
	"src/materials/shaders/pointcloud_sm.fs",
	"src/materials/shaders/normalize.vs",
	"src/materials/shaders/normalize.fs",
	"src/materials/shaders/normalize_xray.fs",
	"src/materials/shaders/normalize_and_edl.fs",
	"src/materials/shaders/edl.vs",
	"src/materials/shaders/edl.fs",
	"src/materials/shaders/blur.vs",
	"src/materials/shaders/blur.fs",
];

// For development, it is now possible to use 'gulp webserver'
// from the command line to start the server (default port is 8080)
gulp.task('webserver', gulp.series(async function() {
	server = connect.server({
		port: 1234,
		https: false,
	});
}));

gulp.task('examples_page', async function(done) {
	await Promise.all([
		createExamplesPage(),
		createGithubPage(),
	]);

	done();
});

gulp.task('icons_viewer', async function(done) {
	await createIconsPage();

	done();

});

gulp.task('test', async function() {

	console.log("asdfiae8ofh");

});

// Preserve WASM and other binary inputs while waiting for all copies to finish.
gulp.task("workers", async function(){
  await Promise.all([
    ...Object.entries(workers).map(([name, inputs]) => pipeline(
      gulp.src(inputs, {encoding: false}),
      concat(name + '.js'),
      gulp.dest('build/potree/workers')
    )),
    pipeline(gulp.src('./libs/copc/laz-perf.wasm', {encoding: false}), gulp.dest('build/potree/workers'))
  ]);
});

gulp.task("lazylibs", async function(){
  await Promise.all(Object.entries(lazyLibs).map(([name, source]) => pipeline(
    gulp.src(source + '/**/*', {encoding: false}),
    gulp.dest('build/potree/lazylibs/' + name)
  )));
});

gulp.task("shaders", async function(){

	const components = [
		"let Shaders = {};"
	];

	for(let file of shaders){
		const filename = path.basename(file);

		const content = await fsp.readFile(file);

		const prep = `Shaders["${filename}"] = \`${content}\``;

		components.push(prep);
	}

	components.push("export {Shaders};");

	const content = components.join("\n\n");

	const targetPath = `./build/shaders/shaders.js`;

	if(!fs.existsSync("build/shaders")){
		fs.mkdirSync("build/shaders");
	}
	fs.writeFileSync(targetPath, content, {flag: "w"});
});

// Internal tasks are composed only by the versioned release transaction.
gulp.task('assets', gulp.series(
  gulp.parallel("workers", "lazylibs", "shaders", "icons_viewer", "examples_page"),
  async function(){
    await Promise.all([
      pipeline(gulp.src(paths.html, {encoding: false}), gulp.dest('build/potree')),
      pipeline(gulp.src(paths.resources, {encoding: false}), gulp.dest('build/potree/resources')),
      pipeline(gulp.src(['LICENSE'], {encoding: false}), gulp.dest('build/potree'))
    ]);
  }
));

gulp.task('bundle', async function(){
  const result = await execFileAsync(process.execPath, [require.resolve('rollup/dist/bin/rollup'), '-c'], {
    cwd: __dirname,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
});

// A single CLI task prevents Gulp from running Rollup before shader generation.
gulp.task('_compile', gulp.series('assets', 'bundle'));

// Legacy "gulp build pack" performs one complete release, using the same CLI options as npm.
async function releaseBuild(){
  const {runBuild, parseBuildArgs} = await import('./scripts/build.mjs');
  return runBuild({root: __dirname, ...parseBuildArgs(process.argv.slice(2), true)});
}
let releasePromise;
function releaseOnce(){
  return releasePromise ??= releaseBuild();
}
gulp.task('build', releaseOnce);
gulp.task('pack', releaseOnce);

// Watch rebuilds keep the pending version and refresh the complete manifest.
gulp.task('watch', gulp.series(releaseBuild, gulp.parallel("webserver", async function() {

	let watchlist = [
		'src/**/*.js',
		'src/**/**/*.js',
		'src/**/*.css',
		'src/**/*.html',
		'src/**/*.vs',
		'src/**/*.fs',
		'resources/**/*',
		'examples//**/*.json',
		'!resources/icons/index.html',
	];

	watch(watchlist, releaseBuild);

})));
