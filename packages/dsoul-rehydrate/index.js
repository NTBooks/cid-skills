'use strict';

// dsoul-rehydrate plugin
//
// This file is bundled inside dsoul.exe as an asset.
// When the user runs `dsoul plugin install dsoul-rehydrate`, dsoul extracts
// this file + package.json to plugins/dsoul-rehydrate/ and runs npm/bun install.
//
// After activation, dsoul loads this file via require() and calls:
//   plugin.run(cliArgs, ui, { runCliRehydrate })
//
// This plugin loads viem from its own node_modules (resolved relative to this
// file's location, so `import('viem')` finds plugins/dsoul-rehydrate/node_modules/viem).
// It then exposes viem to dsoul's courier via global.__dsoulViemProvider.

module.exports = {
  name: 'dsoul-rehydrate',

  help: {
    command: 'rehydrate',
    usage: '<contract> [folder] [--full]',
    description: 'Fetch MappingUpdated events, download IPFS files',
    options: [
      { flag: '--full', description: 'Also download nested CIDs from parsed JSON into files/assets/' },
    ],
  },

  run: async function (cliArgs, ui, { runCliRehydrate }) {
    // Load viem from this plugin's node_modules.
    // Because this file lives in plugins/dsoul-rehydrate/, Node resolves
    // bare specifiers (e.g. 'viem') from plugins/dsoul-rehydrate/node_modules/.
    let viemMod, accountsMod, chainsMod;
    try {
      [viemMod, accountsMod, chainsMod] = await Promise.all([
        import('viem'),
        import('viem/accounts'),
        import('viem/chains'),
      ]);
    } catch (err) {
      throw new Error(
        'Failed to load viem from plugin node_modules. ' +
        'Try running: dsoul plugin install dsoul-rehydrate\n' +
        err.message
      );
    }

    // Expose viem to dsoul's courier via a well-known global.
    // courier.js checks this before attempting its own import('viem').
    global.__dsoulViemProvider = {
      createWalletClient: viemMod.createWalletClient,
      http: viemMod.http,
      webSocket: viemMod.webSocket,
      publicActions: viemMod.publicActions,
      parseAbi: viemMod.parseAbi,
      privateKeyToAccount: accountsMod.privateKeyToAccount,
      chains: chainsMod.default ?? chainsMod,
    };

    try {
      return await runCliRehydrate(cliArgs, ui);
    } finally {
      global.__dsoulViemProvider = null;
    }
  },
};
