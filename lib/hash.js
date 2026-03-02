const Hash = require('ipfs-only-hash');

async function calculateCid(content) {
  let input;
  if (typeof content === 'string') {
    input = Buffer.from(content, 'utf-8');
  } else if (content && typeof content.buffer === 'object' && content.buffer instanceof ArrayBuffer) {
    input = Buffer.from(content);
  } else if (content && content instanceof ArrayBuffer) {
    input = Buffer.from(content);
  } else if (Buffer.isBuffer(content)) {
    input = content;
  } else {
    throw new Error('Content must be a string or buffer');
  }
  return await Hash.of(input);
}

async function calculateCidV0(content) {
  const input = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return await Hash.of(input, { cidVersion: 0 });
}

module.exports = { calculateCid, calculateCidV0 };
