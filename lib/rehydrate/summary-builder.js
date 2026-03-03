const { readFile, readdir } = require('fs').promises;
const path = require('path');

async function buildAndPrintCIDSummary(events, config) {
  try {
    const fileCidToEventMap = new Map();

    for (const event of events) {
      const fileCid = event.args?.value || event.args?.[0];
      if (fileCid && typeof fileCid === 'string') {
        fileCidToEventMap.set(fileCid, {
          blockNumber: event.blockNumber,
          timestamp: event.timestamp,
        });
      }
    }

    const cidInfo = new Map();

    try {
      const files = await readdir(config.filesDirPath);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          let fileCid = null;
          let eventInfo = null;

          if (file.endsWith('.json')) {
            fileCid = file.replace('.json', '');
            eventInfo = fileCidToEventMap.get(fileCid);
          }

          if (!eventInfo) {
            for (const [cid] of fileCidToEventMap.entries()) {
              if (file.startsWith(cid + '.')) {
                fileCid = cid;
                eventInfo = fileCidToEventMap.get(cid);
                break;
              }
            }
          }

          if (!eventInfo) continue;

          const filePath = path.join(config.filesDirPath, file);
          const content = await readFile(filePath, 'utf8');
          const jsonData = JSON.parse(content);

          if (jsonData.filehashes && Array.isArray(jsonData.filehashes)) {
            for (const filehash of jsonData.filehashes) {
              if (filehash.cid) {
                const cid = filehash.cid;
                if (!cidInfo.has(cid)) {
                  cidInfo.set(cid, {
                    blockNumber: eventInfo.blockNumber,
                    timestamp: eventInfo.timestamp,
                    count: 1,
                  });
                } else {
                  const existing = cidInfo.get(cid);
                  existing.count++;
                  if (eventInfo.blockNumber < existing.blockNumber) {
                    existing.blockNumber = eventInfo.blockNumber;
                    existing.timestamp = eventInfo.timestamp;
                  }
                }
              }
            }
          }
        } catch (error) {
          // continue
        }
      }
    } catch (error) {
      console.log('No files directory found, skipping CID summary.');
      return;
    }

    if (cidInfo.size === 0) {
      console.log('\nNo CIDs found in downloaded files.');
      return;
    }

    const summary = Array.from(cidInfo.entries()).map(([cid, info]) => ({
      cid,
      ...info,
    }));

    summary.sort((a, b) => Number(a.blockNumber - b.blockNumber));

    console.log('\n\nCID Summary:');
    console.log('='.repeat(120));
    console.log(
      'CID'.padEnd(52) +
        'EARLIEST BLOCK'.padEnd(18) +
        'TIMESTAMP'.padEnd(25) +
        'COUNT'.padEnd(10)
    );
    console.log('='.repeat(120));

    for (const item of summary) {
      const blockStr = item.blockNumber.toString();
      const timestampStr = item.timestamp
        .toISOString()
        .replace('T', ' ')
        .substring(0, 19);
      const countStr = item.count.toString();

      console.log(
        item.cid.padEnd(52) +
          blockStr.padEnd(18) +
          timestampStr.padEnd(25) +
          countStr.padEnd(10)
      );
    }

    console.log('='.repeat(120));
    console.log(`\nTotal unique CIDs: ${summary.length}`);
    const totalOccurrences = summary.reduce((sum, item) => sum + item.count, 0);
    console.log(`Total occurrences: ${totalOccurrences}`);
  } catch (error) {
    console.error(`Warning: Failed to build CID summary: ${error.message}`);
  }
}

module.exports = { buildAndPrintCIDSummary };
