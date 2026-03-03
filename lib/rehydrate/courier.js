const { createWalletClient, http, webSocket, publicActions, parseAbi } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const chains = require('viem/chains');
const { createRpcManager } = require('./rpc-manager');
const { withRetry } = require('./retry-utils');
const {
  loadLastBlock,
  loadExistingEvents,
  saveLastBlock,
  saveResultsToCSV,
} = require('./file-io');
const { downloadCIDsFromEvents, downloadCIDsToAssets } = require('./ipfs-downloader');
const { processAndSaveChunkEvents } = require('./event-processor');
const { buildAndPrintCIDSummary } = require('./summary-builder');

function createCourier(chain, privateKey, rpc, config) {
  const rpcUrls = {
    base: (process.env.RPC_BASE || '').split(',').filter(Boolean),
  };

  let transport;
  let usedRpc;
  let usedRpcIndex;
  let rpcManager = null;
  let actions;

  if (!rpc && rpcUrls[chain]?.length > 0) {
    rpcManager = createRpcManager(chain, rpcUrls, config);
    const selection = rpcManager.selectRpc();
    usedRpc = selection.usedRpc;
    usedRpcIndex = selection.usedRpcIndex;
    transport = usedRpc.startsWith('wss') ? webSocket(usedRpc) : http(usedRpc);
  } else {
    transport = http();
  }

  const account = privateKeyToAccount(
    `${privateKey.startsWith('0x') ? '' : '0x'}${privateKey}`
  );
  actions = createWalletClient({
    account,
    chain: chains[chain],
    transport,
  }).extend(publicActions);

  const markRpcErrorLocal = (skipFor) => {
    if (rpcManager && typeof usedRpcIndex === 'number') {
      rpcManager.markRpcError(usedRpcIndex, skipFor);
    }
  };

  const markRpcSuccessLocal = () => {
    if (rpcManager && typeof usedRpcIndex === 'number') {
      rpcManager.markRpcSuccess(usedRpcIndex);
    }
  };

  const switchRpc = () => {
    if (rpcManager) {
      const selection = rpcManager.selectRpc();
      const newRpc = selection.usedRpc;
      const newRpcIndex = selection.usedRpcIndex;

      const newTransport = newRpc.startsWith('wss')
        ? webSocket(newRpc)
        : http(newRpc);
      actions = createWalletClient({
        account,
        chain: chains[chain],
        transport: newTransport,
      }).extend(publicActions);

      usedRpcIndex = newRpcIndex;
      console.log(`Switched to RPC: ${newRpc}`);
    }
  };

  const courier = {
    markRpcError: markRpcErrorLocal,
    markRpcSuccess: markRpcSuccessLocal,
    switchRpc,
  };

  const blockChunkSize = config.blockChunkSize;
  const defaultBlockRange = config.defaultBlockRange;

  const calculateStartingBlock = (startingBlock, currentBlock) => {
    if (startingBlock) {
      return startingBlock > 0n
        ? BigInt(startingBlock)
        : currentBlock + BigInt(startingBlock);
    }
    return currentBlock - defaultBlockRange;
  };

  const handleResume = async (originalStartPos, currentBlock) => {
    const savedLastBlock = await loadLastBlock(config);
    if (savedLastBlock !== null && savedLastBlock > originalStartPos) {
      console.log(
        `Resuming from saved last block: ${savedLastBlock} (was going to start from ${originalStartPos})`
      );

      const existingEvents = await loadExistingEvents(config);
      await downloadCIDsFromEvents(existingEvents, config);

      return {
        startPos: savedLastBlock,
        existingEvents,
        existingEventsCount: existingEvents.length,
        isResuming: true,
      };
    }

    return {
      startPos: originalStartPos,
      existingEvents: [],
      existingEventsCount: 0,
      isResuming: false,
    };
  };

  const queryBlockRange = async (
    contractAddress,
    searchAbi,
    fromBlock,
    toBlock,
    currentBlock,
    originalStartPos
  ) => {
    const blocksProcessed = fromBlock - originalStartPos;
    const totalBlocksFromOriginal = currentBlock - originalStartPos;
    const percentComplete =
      totalBlocksFromOriginal > 0n
        ? ((Number(blocksProcessed) / Number(totalBlocksFromOriginal)) * 100).toFixed(1)
        : '0.0';

    process.stdout.write(
      `\r[${percentComplete}%] Querying blocks ${fromBlock} to ${toBlock}...`
    );

    try {
      const logs = await actions.getLogs({
        address: contractAddress,
        event: searchAbi[0],
        fromBlock,
        toBlock,
      });

      if (logs.length > 0) {
        process.stdout.write(` Found ${logs.length} events`);
        const processedEvents = await processAndSaveChunkEvents(
          logs,
          actions,
          config
        );
        await saveLastBlock(toBlock, config);
        return processedEvents;
      }
      await saveLastBlock(toBlock, config);
      return logs;
    } catch (e) {
      process.stdout.write(
        ` Error: ${e.message?.substring(0, 50) || 'Unknown error'}`
      );
      throw e;
    }
  };

  const getHistory = async (
    contractAddress,
    startingBlock,
    isFullMode = false
  ) => {
    console.time('timer');
    try {
      return await withRetry(
        async () => {
          console.log('Getting current block...');
          const currentBlock = await actions.getBlockNumber();
          console.log(`Current block: ${currentBlock}`);

          const originalStartPos = calculateStartingBlock(
            startingBlock,
            currentBlock
          );
          const resumeData = await handleResume(
            originalStartPos,
            currentBlock
          );

          const {
            startPos,
            existingEvents,
            existingEventsCount,
            isResuming,
          } = resumeData;
          const data = [...existingEvents];

          console.log(`Starting from block: ${startPos}`);

          const searchAbi = parseAbi(['event MappingUpdated(string value)']);

          for (
            let blockPos = startPos;
            blockPos < currentBlock;
            blockPos += blockChunkSize
          ) {
            const toBlock =
              blockPos + blockChunkSize > currentBlock
                ? currentBlock
                : blockPos + blockChunkSize;

            const events = await queryBlockRange(
              contractAddress,
              searchAbi,
              blockPos,
              toBlock,
              currentBlock,
              originalStartPos
            );
            data.push(...events);
          }

          const newEventsCount = data.length - existingEventsCount;
          if (isResuming && existingEventsCount > 0) {
            console.log(
              `\n[100%] Found ${newEventsCount} new events (${data.length} total including ${existingEventsCount} existing).`
            );
          } else {
            console.log(`\n[100%] Found ${data.length} total events.`);
          }

          await buildAndPrintCIDSummary(data, config);
          await saveResultsToCSV(data, config);

          if (isFullMode) {
            await downloadCIDsToAssets(config);
          }

          return data;
        },
        courier,
        config
      );
    } finally {
      console.timeEnd('timer');
    }
  };

  courier.getHistory = getHistory;
  return courier;
}

module.exports = { createCourier };
