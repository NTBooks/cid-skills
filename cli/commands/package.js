const path = require('path');
const fs = require('fs').promises;
const { createZipFromDirectory } = require('../../lib/zip');

const PACKAGE_REQUIRED_FILES = ['license.txt', 'skill.md'];

async function runCliPackage(folderArg, ui) {
  const t0 = Date.now();
  try {
    const resolved = path.resolve(process.cwd(), folderArg);
    ui.header('Packaging ' + ui.name(path.basename(resolved)));
    ui.detail('source', resolved);

    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat) { ui.fail('Folder not found: ' + resolved); return false; }
    if (!stat.isDirectory()) { ui.fail('Not a directory: ' + resolved); return false; }

    const folderName = path.basename(resolved);
    ui.step('Validating contents');
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
    const lowerToActual = {};
    fileNames.forEach((n) => { lowerToActual[n.toLowerCase()] = n; });
    const missing = [];
    for (const required of PACKAGE_REQUIRED_FILES) {
      if (!lowerToActual[required]) missing.push(required);
    }
    if (missing.length > 0) { ui.fail('Missing required file(s): ' + missing.join(', ')); return false; }
    ui.ok('Found ' + fileNames.length + ' file(s), all required files present');

    const zipPath = path.join(path.dirname(resolved), folderName + '.zip');
    ui.step('Creating zip archive');
    await createZipFromDirectory(resolved, zipPath);

    const zipStat = await fs.stat(zipPath).catch(() => null);
    const sizeStr = zipStat ? (zipStat.size / 1024).toFixed(1) + ' KB' : '';

    ui.ok('Created ' + ui.name(folderName + '.zip') + (sizeStr ? ' (' + sizeStr + ')' : ''));
    ui.detail('output', zipPath);
    ui.timing('Done', Date.now() - t0);
    return true;
  } catch (err) { ui.fail('Package failed: ' + (err.message || String(err))); return false; }
}

module.exports = { runCliPackage };
