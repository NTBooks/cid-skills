const path = require('path');

const MIME_EXTENSION_MAP = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/json': '.json',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/x-tar': '.tar',
  'application/gzip': '.gz',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
};

const RETRYABLE_ERROR_PATTERNS = [
  'rate limit',
  'too many request',
  '429',
  'timeout',
  'network',
  'connection',
  'econnreset',
  'econnrefused',
  'enotfound',
  'internal error',
  'range is too large',
  'too large',
];

const NON_RETRYABLE_ERROR_PATTERNS = [
  'unauthorized',
  '401',
  '403',
  'forbidden',
];

function buildConfig(dataDirPath) {
  const dataDir = path.isAbsolute(dataDirPath) ? dataDirPath : path.resolve(dataDirPath);
  return {
    dataDirPath: dataDir,
    filesDirPath: path.join(dataDir, 'files'),
    assetsDirPath: path.join(dataDir, 'files', 'assets'),
    lastBlockFile: path.join(dataDir, 'lastblock.txt'),
    resultsCsvFile: path.join(dataDir, 'results.csv'),
    blockFilePrefix: 'block_',
    blockFileSuffix: '.json',
    defaultBlockRange: BigInt(process.env.DEFAULT_BLOCK_RANGE || '50000'),
    blockChunkSize: BigInt(process.env.BLOCK_CHUNK_SIZE || '10000'),
    downloadRateLimitMs: parseInt(process.env.DOWNLOAD_RATE_LIMIT_MS || '1000', 10),
    ipfsGateway: process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs',
    mimeExtensionMap: MIME_EXTENSION_MAP,
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    retryBaseDelay: parseInt(process.env.RETRY_BASE_DELAY || '1000', 10),
    rpcSkipCountRetryable: parseInt(process.env.RPC_SKIP_COUNT_RETRYABLE || '3', 10),
    rpcSkipCountNonRetryable: parseInt(process.env.RPC_SKIP_COUNT_NON_RETRYABLE || '10', 10),
    maxBackoffExponent: parseInt(process.env.MAX_BACKOFF_EXPONENT || '6', 10),
    parallelChunks: Math.max(1, parseInt(process.env.PARALLEL_CHUNKS || '3', 10)),
    retryableErrorPatterns: RETRYABLE_ERROR_PATTERNS,
    nonRetryableErrorPatterns: NON_RETRYABLE_ERROR_PATTERNS,
  };
}

module.exports = { buildConfig, MIME_EXTENSION_MAP, RETRYABLE_ERROR_PATTERNS, NON_RETRYABLE_ERROR_PATTERNS };
