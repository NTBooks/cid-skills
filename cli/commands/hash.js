const path = require('path');
const fs = require('fs').promises;
const { calculateCidV0 } = require('../../lib/hash');

async function runCliHashCidv0(filePath, ui) {
  try {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    ui.step('Hashing', path.basename(resolved));
    ui.detail('path', resolved);
    const buf = await fs.readFile(resolved);
    ui.detail('size', (buf.length / 1024).toFixed(1) + ' KB');
    const cidResult = await calculateCidV0(buf);
    ui.ok('CIDv0: ' + ui.cid(cidResult));
    return true;
  } catch (err) { ui.fail('Hash failed: ' + (err.message || String(err))); return false; }
}

module.exports = { runCliHashCidv0 };
