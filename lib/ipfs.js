const { loadSettings, DEFAULT_IPFS_GATEWAYS } = require('./storage');

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

function normalizeGateways(gateways) {
  return gateways.map((u) => {
    const s = (u || '').trim();
    return s.endsWith('/') ? s : s + '/';
  });
}

async function getConfiguredGateways() {
  const settings = await loadSettings();
  const gateways = Array.isArray(settings.ipfsGateways) && settings.ipfsGateways.length > 0
    ? settings.ipfsGateways
    : DEFAULT_IPFS_GATEWAYS;
  return normalizeGateways(gateways);
}

async function fetchByCid(cid) {
  const gateways = await getConfiguredGateways();
  if (gateways.length > 0) {
    console.error('Trying IPFS gateways:', gateways.join(', '));
  }
  for (const gateway of gateways) {
    try {
      const gatewayUrl = gateway + cid;
      const response = await fetch(gatewayUrl);
      if (!response.ok) continue;
      const contentLength = response.headers.get('Content-Length');
      if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) continue;
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_FILE_SIZE) continue;
      return { buffer: Buffer.from(arrayBuffer) };
    } catch (_) {
      // try next gateway
    }
  }
  return { error: 'Failed to download from all IPFS gateways' };
}

module.exports = { MAX_FILE_SIZE, normalizeGateways, getConfiguredGateways, fetchByCid };
