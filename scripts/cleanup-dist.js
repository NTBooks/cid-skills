/**
 * Removes electron-builder artifacts from dist/ so only installers and update
 * metadata (e.g. .exe, .blockmap, latest.yml) remain.
 */
const fs = require('fs').promises;
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

const REMOVE_PATHS = [
  'win-unpacked',
  'linux-unpacked',
  'mac',
  '.icon-ico',
  'builder-debug.yml',
  'builder-effective-config.yaml',
];

// __appImage-x64, __appImage-arm64, etc.
const UNPACKED_DIR_PREFIX = '__appImage';

const removeIfExists = async (dir, name) => {
  const full = path.join(dir, name);
  try {
    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      await fs.rm(full, { recursive: true });
      return { removed: name, type: 'dir' };
    }
    await fs.unlink(full);
    return { removed: name, type: 'file' };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
};

const listDirectories = async (dir) => {
  const names = await fs.readdir(dir);
  const dirs = [];
  for (const name of names) {
    const full = path.join(dir, name);
    const stat = await fs.stat(full);
    if (stat.isDirectory()) dirs.push(name);
  }
  return dirs;
};

const cleanup = async () => {
  const distExists = await fs.stat(DIST).then(() => true).catch(() => false);
  if (!distExists) {
    console.log('dist/ not found, nothing to clean');
    return;
  }

  const removed = [];

  for (const name of REMOVE_PATHS) {
    const r = await removeIfExists(DIST, name);
    if (r) removed.push(r);
  }

  const topDirs = await listDirectories(DIST);
  for (const name of topDirs) {
    if (name.startsWith(UNPACKED_DIR_PREFIX)) {
      const r = await removeIfExists(DIST, name);
      if (r) removed.push(r);
    }
  }

  if (removed.length) {
    console.log('Removed:', removed.map((r) => r.removed).join(', '));
  } else {
    console.log('No extra dist artifacts to remove.');
  }
};

cleanup().catch((err) => {
  console.error('cleanup-dist failed:', err.message);
  process.exit(1);
});
