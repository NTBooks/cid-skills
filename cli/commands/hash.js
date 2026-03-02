const path = require('path');
const fs = require('fs').promises;
const { calculateCidV0 } = require('../../lib/hash');
const log = require('../log');

async function runCliHashCidv0(filePath) {
  try {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    log.step('Hashing', path.basename(resolved));
    log.detail('path', resolved);
    const buf = await fs.readFile(resolved);
    log.detail('size', `${(buf.length / 1024).toFixed(1)} KB`);
    const cidResult = await calculateCidV0(buf);
    log.ok(`CIDv0: ${log.cid(cidResult)}`);
    return true;
  } catch (err) { log.fail('Hash failed:', err.message || String(err)); return false; }
}

module.exports = { runCliHashCidv0 };
