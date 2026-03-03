const path = require('path');
const { runRehydrate } = require('../../lib/rehydrate');

const CONTRACT_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

async function runCliRehydrate(cliArgs, ui) {
  const contractAddress = (cliArgs.contractAddress || '').trim();
  if (!contractAddress) {
    ui.fail('Contract address is required.');
    return false;
  }
  if (!CONTRACT_ADDRESS_REGEX.test(contractAddress)) {
    ui.fail('Invalid contract address. Expected 0x followed by 40 hex characters.');
    return false;
  }

  const dataDir = path.resolve(process.cwd(), cliArgs.folder || 'data');
  ui.header('Rehydrate');
  ui.detail('contract', contractAddress);
  ui.detail('output', dataDir);
  if (cliArgs.full) ui.detail('mode', 'full (nested assets)');

  try {
    const ok = await runRehydrate(contractAddress, dataDir, { isFullMode: !!cliArgs.full });
    return ok;
  } catch (err) {
    ui.fail('Rehydrate failed: ' + (err.message || String(err)));
    return false;
  }
}

module.exports = { runCliRehydrate };
