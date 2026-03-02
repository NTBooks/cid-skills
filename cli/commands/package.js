const path = require('path');
const fs = require('fs').promises;
const { createZipFromDirectory } = require('../../lib/zip');
const log = require('../log');

const PACKAGE_REQUIRED_FILES = ['license.txt', 'skill.md'];

async function runCliPackage(folderArg) {
  const t0 = Date.now();
  try {
    const resolved = path.resolve(process.cwd(), folderArg);
    log.header(`Packaging ${log.name(path.basename(resolved))}`);
    log.detail('source', resolved);

    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat) { log.fail('Folder not found:', resolved); return false; }
    if (!stat.isDirectory()) { log.fail('Not a directory:', resolved); return false; }

    const folderName = path.basename(resolved);
    log.step('Validating contents');
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
    const lowerToActual = {};
    fileNames.forEach((n) => { lowerToActual[n.toLowerCase()] = n; });
    const missing = [];
    for (const required of PACKAGE_REQUIRED_FILES) {
      if (!lowerToActual[required]) missing.push(required);
    }
    if (missing.length > 0) { log.fail('Missing required file(s):', missing.join(', ')); return false; }
    log.ok(`Found ${fileNames.length} file(s), all required files present`);

    const zipPath = path.join(path.dirname(resolved), folderName + '.zip');
    log.step('Creating zip archive');
    await createZipFromDirectory(resolved, zipPath);

    const zipStat = await fs.stat(zipPath).catch(() => null);
    const sizeStr = zipStat ? `${(zipStat.size / 1024).toFixed(1)} KB` : '';

    log.ok(`Created ${log.name(folderName + '.zip')}${sizeStr ? ' (' + sizeStr + ')' : ''}`);
    log.detail('output', zipPath);
    log.timing('Done', Date.now() - t0);
    return true;
  } catch (err) { log.fail('Package failed:', err.message || String(err)); return false; }
}

module.exports = { runCliPackage };
