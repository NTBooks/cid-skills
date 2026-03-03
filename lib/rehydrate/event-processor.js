const { saveBlockEvents } = require('./file-io');
const { downloadCIDsFromEvents } = require('./ipfs-downloader');

function serializeEventForJSON(event) {
  const serialized = { ...event };
  if (serialized.blockNumber)
    serialized.blockNumber = serialized.blockNumber.toString();
  if (serialized.logIndex !== undefined)
    serialized.logIndex = serialized.logIndex.toString();
  if (serialized.transactionIndex !== undefined)
    serialized.transactionIndex = serialized.transactionIndex.toString();
  if (serialized.timestamp)
    serialized.timestamp = serialized.timestamp.toISOString();
  return serialized;
}

async function processAndSaveChunkEvents(logs, actions, config) {
  if (logs.length === 0) return [];

  try {
    const uniqueBlockNumbers = [...new Set(logs.map((log) => log.blockNumber))];

    const blockTimestampMap = new Map();
    for (const blockNumber of uniqueBlockNumbers) {
      const block = await actions.getBlock({ blockNumber });
      const timestamp = new Date(Number(block.timestamp) * 1000);
      blockTimestampMap.set(blockNumber, timestamp);
    }

    const eventsWithTimestamps = logs.map((log) => ({
      ...log,
      timestamp: blockTimestampMap.get(log.blockNumber),
    }));

    const eventsByBlock = {};
    for (const event of eventsWithTimestamps) {
      const blockNum = event.blockNumber.toString();
      if (!eventsByBlock[blockNum]) {
        eventsByBlock[blockNum] = [];
      }
      eventsByBlock[blockNum].push(serializeEventForJSON(event));
    }

    for (const [blockNum, blockEvents] of Object.entries(eventsByBlock)) {
      await saveBlockEvents(blockNum, blockEvents, config);
    }

    await downloadCIDsFromEvents(eventsWithTimestamps, config);
    return eventsWithTimestamps;
  } catch (error) {
    console.error(`Warning: Failed to save chunk events: ${error.message}`);
    return logs;
  }
}

module.exports = { processAndSaveChunkEvents, serializeEventForJSON };
