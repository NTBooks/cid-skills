const { writeFile, mkdir, readdir, readFile } = require('fs').promises;
const path = require('path');

let lastDownloadTime = 0;

/** Matches "Stamped Bundle: Qm..." (CID v0) or "Stamped Bundle: bafy..." (CID v1) */
const STAMPED_BUNDLE_CID_REGEX = /Stamped Bundle:\s*(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[2-7A-Za-z]{50,})/g;

function getMimeExtension(mimeType, config) {
  return config.mimeExtensionMap[mimeType?.toLowerCase()] || '.bin';
}

async function checkFileExistsByCID(cid, directoryPath) {
  try {
    const files = await readdir(directoryPath);
    for (const file of files) {
      if (file.startsWith(cid + '.')) {
        return path.join(directoryPath, file);
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function downloadFromIPFS(cid, config, targetDir) {
  const dir = targetDir || config.filesDirPath;
  const existingFilePath = await checkFileExistsByCID(cid, dir);
  if (existingFilePath) {
    return { cid, skipped: true, path: existingFilePath };
  }

  const now = Date.now();
  const timeSinceLastDownload = now - lastDownloadTime;
  if (timeSinceLastDownload < config.downloadRateLimitMs) {
    const waitTime = config.downloadRateLimitMs - timeSinceLastDownload;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
  lastDownloadTime = Date.now();

  try {
    const url = `${config.ipfsGateway}/${cid}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    const extension = getMimeExtension(contentType, config);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await mkdir(dir, { recursive: true });

    const filename = `${cid}${extension}`;
    const filePath = path.join(dir, filename);
    await writeFile(filePath, buffer);

    return { cid, extension, path: filePath, size: buffer.length };
  } catch (error) {
    console.error(`Warning: Failed to download IPFS file ${cid}: ${error.message}`);
    return { cid, error: error.message };
  }
}

async function downloadFromIPFSWithRetry(cid, config, targetDir) {
  const dir = targetDir || config.assetsDirPath;
  const existingFilePath = await checkFileExistsByCID(cid, dir);
  if (existingFilePath) {
    return { cid, skipped: true, path: existingFilePath };
  }

  const maxRetries = config.maxRetries;
  const retryBaseDelay = config.retryBaseDelay;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const now = Date.now();
    const timeSinceLastDownload = now - lastDownloadTime;
    if (timeSinceLastDownload < config.downloadRateLimitMs) {
      const waitTime = config.downloadRateLimitMs - timeSinceLastDownload;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    lastDownloadTime = Date.now();

    try {
      const url = `${config.ipfsGateway}/${cid}`;
      const response = await fetch(url);

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitTime = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : retryBaseDelay * Math.pow(2, attempt);

        if (attempt < maxRetries) {
          console.log(
            `Rate limited (429) for ${cid}, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
        throw new Error(`HTTP 429: Rate limited after ${maxRetries} retries`);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      const extension = getMimeExtension(contentType, config);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await mkdir(dir, { recursive: true });

      const filename = `${cid}${extension}`;
      const filePath = path.join(dir, filename);
      await writeFile(filePath, buffer);

      return { cid, extension, path: filePath, size: buffer.length };
    } catch (error) {
      lastError = error;
      const isRateLimit =
        error.message?.includes('429') ||
        error.message?.toLowerCase().includes('rate limit');

      if (isRateLimit && attempt < maxRetries) {
        const waitTime = retryBaseDelay * Math.pow(2, attempt);
        console.log(
          `Rate limited (429) for ${cid}, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
      if (attempt === maxRetries) {
        console.error(
          `Warning: Failed to download IPFS file ${cid} after ${maxRetries} retries: ${error.message}`
        );
        return { cid, error: error.message };
      }
      if (attempt < maxRetries) {
        const waitTime = retryBaseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  return { cid, error: lastError?.message || 'Unknown error' };
}

async function downloadCIDsFromEvents(events, config) {
  const cids = new Set();
  for (const event of events) {
    const cid = event.args?.value || event.args?.[0];
    if (cid && typeof cid === 'string' && cid.length > 0) {
      cids.add(cid);
    }
  }

  if (cids.size === 0) return;

  console.log(`\nDownloading ${cids.size} file(s) from IPFS...`);
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const cid of cids) {
    const result = await downloadFromIPFS(cid, config);
    if (result.error) {
      failed++;
    } else if (result.skipped) {
      skipped++;
    } else {
      downloaded++;
      if (downloaded % 10 === 0) {
        process.stdout.write(`\rDownloaded ${downloaded}/${cids.size} files...`);
      }
    }
  }

  if (downloaded > 0 || skipped > 0 || failed > 0) {
    console.log(
      `\nDownloaded ${downloaded} new file(s), ${skipped} already existed, ${failed} failed.`
    );
  }
}

async function extractStampedBundleCidsFromFiles(config) {
  const cids = new Set();
  try {
    const files = await readdir(config.filesDirPath);
    for (const file of files) {
      try {
        const filePath = path.join(config.filesDirPath, file);
        const content = await readFile(filePath, 'utf8');
        let match;
        STAMPED_BUNDLE_CID_REGEX.lastIndex = 0;
        while ((match = STAMPED_BUNDLE_CID_REGEX.exec(content)) !== null) {
          if (match[1]) cids.add(match[1]);
        }
      } catch {
        // Skip files that can't be read as utf8 or don't match
      }
    }
  } catch (error) {
    return [];
  }
  return Array.from(cids);
}

async function downloadStampedBundleCids(config) {
  const cids = await extractStampedBundleCidsFromFiles(config);
  if (cids.length === 0) return;

  console.log(`\nFound ${cids.length} Stamped Bundle CID(s) in downloaded files. Downloading from IPFS...`);
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const cid of cids) {
    const result = await downloadFromIPFS(cid, config);
    if (result.error) {
      failed++;
    } else if (result.skipped) {
      skipped++;
    } else {
      downloaded++;
      if (downloaded % 10 === 0) {
        process.stdout.write(`\rStamped bundles: ${downloaded}/${cids.length}...`);
      }
    }
  }

  console.log(
    `\nStamped bundles: ${downloaded} new, ${skipped} already existed, ${failed} failed.`
  );
}

async function extractCIDsFromFiles(config) {
  const cids = new Set();

  try {
    const files = await readdir(config.filesDirPath);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    for (const file of jsonFiles) {
      try {
        const filePath = path.join(config.filesDirPath, file);
        const content = await readFile(filePath, 'utf8');
        const jsonData = JSON.parse(content);

        if (jsonData.filehashes && Array.isArray(jsonData.filehashes)) {
          for (const filehash of jsonData.filehashes) {
            if (
              filehash.cid &&
              typeof filehash.cid === 'string' &&
              filehash.cid.length > 0
            ) {
              cids.add(filehash.cid);
            }
          }
        }
      } catch (error) {
        // Skip files that can't be parsed
      }
    }
  } catch (error) {
    console.log('No files directory found, skipping CID extraction.');
    return [];
  }

  return Array.from(cids);
}

async function downloadCIDsToAssets(config) {
  const cids = await extractCIDsFromFiles(config);

  if (cids.length === 0) {
    console.log('\nNo CIDs found in downloaded files to download as assets.');
    return;
  }

  console.log(
    `\nDownloading ${cids.length} asset CID(s) from IPFS to assets directory...`
  );
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < cids.length; i++) {
    const cid = cids[i];
    const result = await downloadFromIPFSWithRetry(cid, config);

    if (result.error) {
      failed++;
    } else if (result.skipped) {
      skipped++;
    } else {
      downloaded++;
    }

    if ((i + 1) % 10 === 0 || i === cids.length - 1) {
      process.stdout.write(
        `\rDownloaded ${downloaded}/${cids.length} assets (${skipped} skipped, ${failed} failed)...`
      );
    }
  }

  console.log(
    `\nAsset download complete: ${downloaded} new file(s), ${skipped} already existed, ${failed} failed.`
  );
}

module.exports = {
  downloadCIDsFromEvents,
  downloadStampedBundleCids,
  extractCIDsFromFiles,
  downloadCIDsToAssets,
};
