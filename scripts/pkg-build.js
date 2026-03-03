/**
 * Runs pkg with a version-stamped output filename.
 * Usage: node scripts/pkg-build.js <platform>
 * Platforms: win | mac | linux
 */
const { execSync } = require('child_process');
const path = require('path');

const { version } = require('../package.json');

const TARGETS = {
  win:   { target: 'node20-win-x64',                          out: `dist/dsoul-${version}.exe` },
  mac:   { target: 'node20-macos-x64,node20-macos-arm64',     out: `dist/dsoul-${version}-mac` },
  linux: { target: 'node20-linux-x64',                        out: `dist/dsoul-${version}-linux` },
};

const platform = process.argv[2];
const config = TARGETS[platform];

if (!config) {
  console.error(`Unknown platform "${platform}". Use: win | mac | linux`);
  process.exit(1);
}

const root = path.join(__dirname, '..');

console.log('Bundling public files into server/static.js...');
execSync('node scripts/bundle-public.js', { stdio: 'inherit', cwd: root });

console.log('Bundling plugin packages into packages/bundles.js...');
execSync('node scripts/bundle-packages.js', { stdio: 'inherit', cwd: root });

const cmd = `pkg bin/dsoul.js --targets ${config.target} --output ${config.out}`;
console.log(`Building ${platform} v${version} → ${config.out}`);
execSync(cmd, { stdio: 'inherit', cwd: root });
