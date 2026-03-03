#!/usr/bin/env node

// This file is bundled into a single CJS file (dist/dsoul-rehydrate.js) using:
//   bun build packages/dsoul-rehydrate/bin/index.js --format=cjs --outfile=dist/dsoul-rehydrate.js --target=node
//
// The bundle includes viem and all lib/rehydrate/* code.
// It is loaded by dsoul via require() from a plugins/ folder next to the binary.

const path = require('path');
const { runCliRehydrate } = require('../../../cli/commands/rehydrate');
const { createUi } = require('../../../cli/ui-adapter');

// Plugin interface — called by dsoul when rehydrate command is used
async function run(cliArgs, ui) {
  return runCliRehydrate(cliArgs, ui);
}

module.exports = { run };

// Standalone CLI support: node dsoul-rehydrate.js <contractAddress> [folder] [--full]
if (require.main === module) {
  const CONTRACT_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
  const argv = process.argv.slice(2);
  const nonFlags = argv.filter((a) => !a.startsWith('-'));
  const contractAddress = (nonFlags[0] || '').trim();
  const folder = (nonFlags[1] || 'data').trim();
  const full = argv.includes('--full');

  if (!contractAddress || !CONTRACT_ADDRESS_REGEX.test(contractAddress)) {
    console.error('Usage: dsoul-rehydrate <0x...contractAddress> [folder] [--full]');
    process.exit(1);
  }

  const ui = createUi('console');
  run({ contractAddress, folder, full }, ui)
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => { console.error('Fatal:', err.message || err); process.exit(1); });
}
