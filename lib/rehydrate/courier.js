const { createRpcManager } = require('./rpc-manager');

let viemCache = null;

async function getViem() {
  if (viemCache) return viemCache;
  const [viem, accounts, chainsModule] = await Promise.all([
    import('viem'),
    import('viem/accounts'),
    import('viem/chains'),
  ]);
  const chains = chainsModule.default ?? chainsModule;
  viemCache = {
    createWalletClient: viem.createWalletClient,
    http: viem.http,
    webSocket: viem.webSocket,
    publicActions: viem.publicActions,
    parseAbi: viem.parseAbi,
    privateKeyToAccount: accounts.privateKeyToAccount,
    chains,
  };
  return viemCache;
}
const { withRetry, isRetryableError } = require('./retry-utils');
const { c } = require('./colors');
const {
  loadLastBlock,
  loadExistingEvents,
  saveLastBlock,
  saveResultsToCSV,
} = require('./file-io');
const { downloadCIDsFromEvents, downloadCIDsToAssets } = require('./ipfs-downloader');
const { processAndSaveChunkEvents } = require('./event-processor');
const { buildAndPrintCIDSummary } = require('./summary-builder');

async function createCourier(chain, privateKey, rpc, config) {
  const {
    createWalletClient,
    http,
    webSocket,
    publicActions,
    parseAbi,
    privateKeyToAccount,
    chains,
  } = await getViem();

  const rpcUrls = {
    base: (process.env.RPC_BASE || '').split(',').filter(Boolean),
  };

  let transport;
  let usedRpc;
  let usedRpcIndex;
  let totalRpcs = 0;
  let rpcManager = null;
  let actions;
  let actionsPool = null;

  if (!rpc && rpcUrls[chain]?.length > 0) {
    rpcManager = createRpcManager(chain, rpcUrls, config);
    const selection = rpcManager.selectRpc();
    usedRpc = selection.usedRpc;
    usedRpcIndex = selection.usedRpcIndex;
    totalRpcs = selection.totalRpcs ?? rpcUrls[chain].length;
    transport = usedRpc.startsWith('wss') ? webSocket(usedRpc) : http(usedRpc);
    const rpcLabel = totalRpcs > 1
      ? `${c.cyan}RPC ${usedRpcIndex + 1}/${totalRpcs}${c.reset}`
      : `${c.cyan}RPC (single endpoint)${c.reset}`;
    console.log(`Using ${rpcLabel}: ${c.dim}${usedRpc}${c.reset}`);
    if (totalRpcs === 1) {
      console.log(`${c.gray}Tip: set RPC_BASE to comma-separated URLs for round-robin and parallel fetch.${c.reset}`);
    }
    const account = privateKeyToAccount(
      `${privateKey.startsWith('0x') ? '' : '0x'}${privateKey}`
    );
    actionsPool = rpcUrls[chain].map((url) => {
      const t = url.startsWith('wss') ? webSocket(url) : http(url);
      return createWalletClient({
        account,
        chain: chains[chain],
        transport: t,
      }).extend(publicActions);
    });
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
  if (!actionsPool) actionsPool = [actions];

  const markRpcErrorLocal = (rpcIndexOrSkipFor, skipFor) => {
    if (!rpcManager) return;
    const idx = typeof rpcIndexOrSkipFor === 'number' ? rpcIndexOrSkipFor : usedRpcIndex;
    const skip = typeof rpcIndexOrSkipFor === 'number' ? skipFor : rpcIndexOrSkipFor;
    if (typeof idx === 'number') rpcManager.markRpcError(idx, skip);
    if (courier.suppressRpcLog !== true) rpcManager.logRpcScores();
  };

  const markRpcSuccessLocal = () => {
    if (rpcManager && typeof usedRpcIndex === 'number') {
      rpcManager.markRpcSuccess(usedRpcIndex);
    }
  };

  const switchRpc = () => {
    if (!rpcManager) return false;
    const selection = rpcManager.selectRpc();
    const newRpc = selection.usedRpc;
    const newRpcIndex = selection.usedRpcIndex;
    const total = selection.totalRpcs ?? 1;
    const actuallySwitched = total > 1 && newRpcIndex !== usedRpcIndex;

    const newTransport = newRpc.startsWith('wss')
      ? webSocket(newRpc)
      : http(newRpc);
    actions = createWalletClient({
      account,
      chain: chains[chain],
      transport: newTransport,
    }).extend(publicActions);

    usedRpcIndex = newRpcIndex;
    if (actuallySwitched) {
      console.log(`${c.cyan}Switched to RPC ${newRpcIndex + 1}/${total}:${c.reset} ${c.dim}${newRpc}${c.reset}`);
    } else if (total === 1) {
      console.log(`${c.yellow}Only one RPC configured; retrying same endpoint.${c.reset}`);
    } else {
      console.log(`${c.yellow}All RPCs temporarily skipped; retrying least-failed (${newRpcIndex + 1}/${total}):${c.reset} ${c.dim}${newRpc}${c.reset}`);
    }
    return actuallySwitched;
  };

  const courier = {
    markRpcError: markRpcErrorLocal,
    markRpcSuccess: markRpcSuccessLocal,
    switchRpc,
    suppressRpcLog: false,
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
        `${c.cyan}Resuming from saved last block: ${savedLastBlock}${c.reset} ${c.dim}(was going to start from ${originalStartPos})${c.reset}`
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

  async function runWithConcurrency(tasks, concurrency) {
    const results = [];
    const running = new Set();
    for (const task of tasks) {
      const p = Promise.resolve().then(() => task()).then((r) => {
        running.delete(p);
        return r;
      });
      running.add(p);
      results.push(p);
      if (running.size >= concurrency) {
        await Promise.race(running);
      }
    }
    return Promise.all(results);
  }

  const fetchChunk = async (
    contractAddress,
    searchAbi,
    fromBlock,
    toBlock,
    chunkIndex,
    totalChunks,
    currentBlock,
    originalStartPos
  ) => {
    const totalBlocksFromOriginal = currentBlock - originalStartPos;
    let rpcIndex = chunkIndex % actionsPool.length;
    let lastError;
    for (let attempt = 0; attempt < actionsPool.length; attempt++) {
      try {
        const logs = await actionsPool[rpcIndex].getLogs({
          address: contractAddress,
          event: searchAbi[0],
          fromBlock,
          toBlock,
        });
        if (rpcManager) rpcManager.markRpcSuccess(rpcIndex);
        return { fromBlock, toBlock, logs, rpcIndex };
      } catch (e) {
        lastError = e;
        const skipFor = isRetryableError(e, config)
          ? config.rpcSkipCountRetryable
          : config.rpcSkipCountNonRetryable;
        markRpcErrorLocal(rpcIndex, skipFor);
        const selection = rpcManager ? rpcManager.selectRpc() : { usedRpcIndex: 0 };
        rpcIndex = selection.usedRpcIndex;
      }
    }
    throw lastError;
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
      `\r${c.cyan}[${percentComplete}%]${c.reset} Querying blocks ${c.dim}${fromBlock}-${toBlock}${c.reset}...`
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
        `\n${c.red} Error: ${e.message?.substring(0, 50) || 'Unknown error'}${c.reset}`
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
          console.log(`${c.dim}Getting current block...${c.reset}`);
          const currentBlock = await actions.getBlockNumber();
          console.log(`${c.dim}Current block:${c.reset} ${c.cyan}${currentBlock}${c.reset}`);

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

          const totalChunks = Number((currentBlock - startPos) / blockChunkSize) || 1;
          const parallelChunks = config.parallelChunks ?? 1;
          const useParallel = parallelChunks > 1 && actionsPool.length > 0;
          console.log(
            `${c.dim}Starting from block:${c.reset} ${c.cyan}${startPos}${c.reset} ${c.dim}(${totalChunks} chunk(s), ~${blockChunkSize} blocks each)${useParallel ? `, parallel: ${Math.min(parallelChunks, totalChunks)}` : ''}${c.reset}`
          );

          const searchAbi = parseAbi(['event MappingUpdated(string value)']);

          if (useParallel) {
            const chunks = [];
            for (let blockPos = startPos; blockPos < currentBlock; blockPos += blockChunkSize) {
              const toBlock =
                blockPos + blockChunkSize > currentBlock ? currentBlock : blockPos + blockChunkSize;
              chunks.push({ fromBlock: blockPos, toBlock });
            }
            const totalChunks = chunks.length;
            const mainQueue = chunks.map((c, i) => ({ ...c, chunkIndex: i }));
            const retryQueue = [];
            const resultsMap = new Map();
            let lastWrittenBlock = startPos - 1n;
            let completedChunks = 0;
            const numSlots = Math.min(parallelChunks, totalChunks);
            const slotLines = Array(numSlots).fill(`${c.gray}  (idle)${c.reset}`);
            const totalBlocks = Number(currentBlock - startPos);
            courier.suppressRpcLog = true;
            const writeProgress = () => {
              const doneBlocks = Number(lastWrittenBlock - startPos + 1n);
              const pct = totalBlocks > 0 ? ((doneBlocks / totalBlocks) * 100).toFixed(1) : '0.0';
              const overall = `${c.cyan}Overall:${c.reset} ${c.bold}${c.green}${pct}%${c.reset} (${completedChunks}/${totalChunks} chunks) ${c.dim}|${c.reset} last block: ${c.cyan}${lastWrittenBlock}${c.reset}`;
              const rpcLine = rpcManager ? rpcManager.getStatusLine() : '';
              const lines = rpcLine ? [...slotLines, overall, rpcLine] : [...slotLines, overall];
              process.stdout.write('\x1b[' + lines.length + 'A');
              lines.forEach((line) => process.stdout.write('\r\x1b[2K' + line + '\n'));
            };
            let drainLock = Promise.resolve();
            const drain = async () => {
              const prev = drainLock;
              let release;
              drainLock = new Promise((r) => { release = r; });
              await prev;
              try {
                for (;;) {
                  const nextKey = [...resultsMap.keys()].filter((k) => k <= lastWrittenBlock + 1n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
                  if (nextKey === undefined) break;
                  const { toBlock, logs } = resultsMap.get(nextKey);
                  resultsMap.delete(nextKey);
                  if (logs.length > 0) {
                    const processed = await processAndSaveChunkEvents(logs, actions, config);
                    data.push(...processed);
                  }
                  await saveLastBlock(toBlock, config);
                  lastWrittenBlock = toBlock;
                }
                writeProgress();
              } finally {
                release();
              }
            };
            const runWorker = async (slotId) => {
              for (;;) {
                const chunk = retryQueue.shift() || mainQueue.shift();
                if (!chunk) break;
                const { fromBlock, toBlock, chunkIndex } = chunk;
                slotLines[slotId] = `  ${c.yellow}[${chunkIndex + 1}/${totalChunks}]${c.reset} ${fromBlock}-${toBlock} ${c.dim}...${c.reset}`;
                writeProgress();
                let success = false;
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    const result = await fetchChunk(
                      contractAddress,
                      searchAbi,
                      fromBlock,
                      toBlock,
                      chunkIndex,
                      totalChunks,
                      currentBlock,
                      originalStartPos
                    );
                    resultsMap.set(result.fromBlock, { toBlock: result.toBlock, logs: result.logs });
                    await drain();
                    completedChunks++;
                    slotLines[slotId] = `  ${c.cyan}[${chunkIndex + 1}/${totalChunks}]${c.reset} ${fromBlock}-${toBlock} ${c.green}✓ OK${c.reset}`;
                    success = true;
                    break;
                  } catch (e) {
                    const msg = (e.message || 'error').slice(0, 35);
                    slotLines[slotId] = `  ${c.cyan}[${chunkIndex + 1}/${totalChunks}]${c.reset} ${fromBlock}-${toBlock} ${c.red}✗${c.reset} ${c.red}${msg}${c.reset}${attempt < 2 ? ` ${c.yellow}(retry)${c.reset}` : ''}`;
                    writeProgress();
                    if (attempt < 2) {
                      const delayMs = (config.retryBaseDelay ?? 1000) * Math.pow(2, attempt);
                      await new Promise((r) => setTimeout(r, delayMs));
                    } else {
                      chunk.retries = (chunk.retries || 0) + 1;
                      if (chunk.retries < 5) retryQueue.push(chunk);
                    }
                  }
                }
                if (!success) writeProgress();
              }
              slotLines[slotId] = `${c.gray}  (idle)${c.reset}`;
              writeProgress();
            };
            const rpcLine = rpcManager ? rpcManager.getStatusLine() : '';
            const numProgressLines = numSlots + 1 + (rpcLine ? 1 : 0);
            for (let i = 0; i < slotLines.length; i++) process.stdout.write(slotLines[i] + '\n');
            process.stdout.write(`${c.cyan}Overall:${c.reset} ${c.bold}${c.green}0.0%${c.reset} (0/${totalChunks} chunks) ${c.dim}|${c.reset} last block: ${c.cyan}${lastWrittenBlock}${c.reset}\n`);
            if (rpcLine) process.stdout.write(rpcLine + '\n');
            await Promise.all(Array.from({ length: numSlots }, (_, i) => runWorker(i)));
            courier.suppressRpcLog = false;
            process.stdout.write('\x1b[' + numProgressLines + 'A\r\x1b[J');
          } else {
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
          }

          const newEventsCount = data.length - existingEventsCount;
          if (isResuming && existingEventsCount > 0) {
            console.log(
              `\n${c.green}[100%]${c.reset} Found ${c.green}${newEventsCount} new events${c.reset} (${data.length} total including ${existingEventsCount} existing).`
            );
          } else {
            console.log(`\n${c.green}[100%]${c.reset} Found ${c.green}${data.length} total events${c.reset}.`);
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
