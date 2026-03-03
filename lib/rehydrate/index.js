const path = require('path');
const { buildConfig } = require('./constants');
const { createCourier } = require('./courier');
const { loadDotEnv } = require('../config');
const { c } = require('./colors');
const { loadSettings, DEFAULT_RPC_BASE } = require('../storage');

const DUMMY_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000001';

async function runRehydrate(contractAddress, dataDir, options = {}) {
  const env = await loadDotEnv();
  for (const [key, val] of Object.entries(env)) {
    if (val != null && val !== '') process.env[key] = val;
  }

  const dataDirPath = path.isAbsolute(dataDir)
    ? dataDir
    : path.resolve(process.cwd(), dataDir);
  const config = buildConfig(dataDirPath);

  if (!process.env.RPC_BASE) {
    const settings = await loadSettings();
    const fromSettings = (settings.rpcBase && String(settings.rpcBase).trim()) || '';
    process.env.RPC_BASE = fromSettings || DEFAULT_RPC_BASE;
  }

  const rpcList = (process.env.RPC_BASE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (rpcList.length > 0) {
    console.log(
      `${c.dim}RPC endpoints (${rpcList.length}):${c.reset}`
    );
    rpcList.forEach((url, i) => {
      console.log(`  ${c.cyan}[${i}]${c.reset} ${c.dim}${url}${c.reset}`);
    });
  }

  const chain = process.env.CHAIN || 'base';
  const startingBlockRaw = process.env.STARTING_BLOCK || '30974622';
  const startingBlock = BigInt(startingBlockRaw);
  const isFullMode = !!options.isFullMode;

  console.log(`${c.cyan}Fetching UpdateMapping events...${c.reset}`);
  console.log(`${c.dim}Contract:${c.reset} ${contractAddress}`);
  console.log(`${c.dim}Original starting block:${c.reset} ${startingBlock}`);
  console.log(`${c.dim}Chain:${c.reset} ${c.cyan}${chain}${c.reset}`);
  if (isFullMode) {
    console.log(`${c.yellow}Mode: FULL${c.reset} (will download asset CIDs from parsed files)\n`);
  } else {
    console.log(`${c.dim}Mode: STANDARD${c.reset}\n`);
  }

  const courier = await createCourier(chain, DUMMY_PRIVATE_KEY, null, config);
  let history;
  try {
    history = await courier.getHistory(
      contractAddress,
      startingBlock,
      isFullMode
    );
  } catch (error) {
    console.error('Error fetching events:', error.message);
    throw error;
  }

  if (!history || history.length === 0) {
    console.log('No UpdateMapping events found.');
    return true;
  }

  history.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const TXID_WIDTH = 50;
  const TIMESTAMP_WIDTH = 20;
  const TEXT_VALUE_WIDTH = 52;
  const TOTAL_WIDTH = TXID_WIDTH + TIMESTAMP_WIDTH + TEXT_VALUE_WIDTH;

  console.log('\nUpdateMapping Events:');
  console.log('='.repeat(TOTAL_WIDTH));

  const header =
    'TXID'.padEnd(TXID_WIDTH) +
    'TIMESTAMP'.padEnd(TIMESTAMP_WIDTH) +
    'TEXT VALUE';
  console.log(header);
  console.log('='.repeat(TOTAL_WIDTH));

  for (const item of history) {
    const txidShort =
      item.transactionHash.substring(0, 10) +
      '...' +
      item.transactionHash.substring(58);
    const timestamp = item.timestamp
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19);
    const textValue =
      item.args?.value || item.args?.[0] || item.data || 'N/A';
    const displayValue =
      textValue.length > TEXT_VALUE_WIDTH
        ? textValue.substring(0, TEXT_VALUE_WIDTH - 3) + '...'
        : textValue;

    const row =
      txidShort.padEnd(TXID_WIDTH) +
      timestamp.padEnd(TIMESTAMP_WIDTH) +
      displayValue;
    console.log(row);
  }

  console.log('='.repeat(TOTAL_WIDTH));
  console.log(`\nTotal events found: ${history.length}`);

  return true;
}

module.exports = { runRehydrate };
