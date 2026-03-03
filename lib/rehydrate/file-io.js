const { writeFile, mkdir, readFile, readdir } = require('fs').promises;
const path = require('path');

async function saveLastBlock(blockNumber, config) {
  try {
    await mkdir(config.dataDirPath, { recursive: true });
    await writeFile(config.lastBlockFile, blockNumber.toString(), 'utf8');
  } catch (error) {
    console.error(`Warning: Failed to save last block: ${error.message}`);
  }
}

async function loadLastBlock(config) {
  try {
    const content = await readFile(config.lastBlockFile, 'utf8');
    const blockNumber = BigInt(content.trim());
    return blockNumber;
  } catch (error) {
    return null;
  }
}

async function loadExistingEvents(config) {
  try {
    const files = await readdir(config.dataDirPath);
    const blockFiles = files.filter(
      (f) =>
        f.startsWith(config.blockFilePrefix) && f.endsWith(config.blockFileSuffix)
    );

    if (blockFiles.length === 0) {
      return [];
    }

    console.log(`Loading ${blockFiles.length} existing block file(s)...`);
    const allEvents = [];

    for (const file of blockFiles) {
      try {
        const filePath = path.join(config.dataDirPath, file);
        const content = await readFile(filePath, 'utf8');
        const events = JSON.parse(content);

        for (const event of events) {
          if (event.blockNumber) event.blockNumber = BigInt(event.blockNumber);
          if (event.logIndex !== undefined) event.logIndex = BigInt(event.logIndex);
          if (event.transactionIndex !== undefined)
            event.transactionIndex = BigInt(event.transactionIndex);
          if (event.timestamp) event.timestamp = new Date(event.timestamp);
          allEvents.push(event);
        }
      } catch (error) {
        console.error(`Warning: Failed to load ${file}: ${error.message}`);
      }
    }

    console.log(`Loaded ${allEvents.length} existing events from saved files.`);
    return allEvents;
  } catch (error) {
    console.error(`Warning: Failed to load existing events: ${error.message}`);
    return [];
  }
}

async function saveBlockEvents(blockNumber, events, config) {
  try {
    await mkdir(config.dataDirPath, { recursive: true });
    const filename = path.join(
      config.dataDirPath,
      `${config.blockFilePrefix}${blockNumber}${config.blockFileSuffix}`
    );
    await writeFile(filename, JSON.stringify(events, null, 2), 'utf8');
  } catch (error) {
    console.error(`Warning: Failed to save block events: ${error.message}`);
  }
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (
    stringValue.includes(',') ||
    stringValue.includes('"') ||
    stringValue.includes('\n')
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

async function saveResultsToCSV(events, config) {
  try {
    if (events.length === 0) return;

    const headers = ['TransactionHash', 'BlockNumber', 'Timestamp', 'CID'];
    const rows = [headers.join(',')];

    for (const event of events) {
      const txHash = event.transactionHash || '';
      const blockNumber = event.blockNumber?.toString() || '';
      const timestamp = event.timestamp
        ? event.timestamp instanceof Date
          ? event.timestamp.toISOString()
          : event.timestamp
        : '';
      const cid = event.args?.value || event.args?.[0] || event.data || '';

      const row = [
        escapeCSV(txHash),
        escapeCSV(blockNumber),
        escapeCSV(timestamp),
        escapeCSV(cid),
      ];
      rows.push(row.join(','));
    }

    const csvContent = rows.join('\n');
    await mkdir(config.dataDirPath, { recursive: true });
    await writeFile(config.resultsCsvFile, csvContent, 'utf8');
    console.log(`\nSaved ${events.length} results to ${config.resultsCsvFile}`);
  } catch (error) {
    console.error(`Warning: Failed to save results CSV: ${error.message}`);
  }
}

module.exports = {
  saveLastBlock,
  loadLastBlock,
  loadExistingEvents,
  saveBlockEvents,
  saveResultsToCSV,
};
