/**
 * Copies leveldown prebuilds to dist/prebuilds so pkg-built executables
 * can load the native addon (pkg cannot bundle the prebuilds directory).
 */
const fs = require('fs').promises;
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LEVELDOWN_PREBUILDS = path.join(ROOT, 'node_modules', 'leveldown', 'prebuilds');

async function copyPrebuilds() {
  try {
    await fs.access(LEVELDOWN_PREBUILDS);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  const dest = path.join(DIST, 'prebuilds');
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(LEVELDOWN_PREBUILDS, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(LEVELDOWN_PREBUILDS, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      await fs.cp(srcPath, destPath, { recursive: true });
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
  console.log('Copied leveldown prebuilds to dist/prebuilds');
}

copyPrebuilds().catch((err) => {
  console.warn('copy-prebuilds:', err.message);
  process.exitCode = 1;
});
