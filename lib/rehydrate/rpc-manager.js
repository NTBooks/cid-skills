const { c } = require('./colors');

function createRpcManager(chain, rpcUrls, config) {
  const rpcSkipCountRetryable = config.rpcSkipCountRetryable;
  const rpcSkipCountNonRetryable = config.rpcSkipCountNonRetryable;
  const retryBaseDelay = config.retryBaseDelay ?? 1000;
  const maxBackoffExponent = config.maxBackoffExponent ?? 6;

  const rpcRoundRobinIndex = {};
  const rpcStatus = {};

  function getStatusLine() {
    if (!rpcUrls[chain]?.length) return '';
    if (!rpcStatus[chain]) {
      rpcStatus[chain] = rpcUrls[chain].map(() => ({
        skipCount: 0,
        errorCount: 0,
        successCount: 0,
        backoffUntil: 0,
      }));
    }
    const parts = rpcUrls[chain].map((url, i) => {
      const status = rpcStatus[chain][i];
      const backoffMs = (status.backoffUntil ?? 0) - Date.now();
      const backoff = backoffMs > 0 ? ` ${c.yellow}~${Math.ceil(backoffMs / 1000)}s${c.reset}` : '';
      const short = url.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
      return `${c.cyan}[${i}]${c.reset}${short.slice(0, 20)} ${c.green}✓${status.successCount}${c.reset} ${c.red}✗${status.errorCount}${c.reset}${backoff}`;
    });
    return `${c.cyan}RPC ${chain}:${c.reset} ${parts.join(` ${c.dim}|${c.reset} `)}`;
  }

  function logRpcScores() {
    const line = getStatusLine();
    if (line) console.log(line);
  }

  function markRpcError(rpcIndex, skipFor = rpcSkipCountRetryable) {
    if (!rpcStatus[chain] || !rpcStatus[chain][rpcIndex]) return;
    const status = rpcStatus[chain][rpcIndex];
    status.errorCount++;
    status.skipCount = skipFor;
    const exponent = Math.min(status.errorCount, maxBackoffExponent);
    const backoffMs = retryBaseDelay * Math.pow(2, exponent);
    status.backoffUntil = Date.now() + backoffMs;
  }

  function markRpcSuccess(rpcIndex) {
    if (!rpcStatus[chain] || !rpcStatus[chain][rpcIndex]) return;
    const status = rpcStatus[chain][rpcIndex];
    status.successCount++;
    status.skipCount = 0;
    status.backoffUntil = 0;
  }

  function selectRpcUrl() {
    if (!rpcStatus[chain]) {
      rpcStatus[chain] = rpcUrls[chain].map(() => ({
        skipCount: 0,
        errorCount: 0,
        successCount: 0,
        backoffUntil: 0,
      }));
    }
    if (typeof rpcRoundRobinIndex[chain] !== 'number') {
      rpcRoundRobinIndex[chain] = 0;
    }

    const numRpcUrls = rpcUrls[chain].length;
    const now = Date.now();
    const startIdx = rpcRoundRobinIndex[chain];
    let usedRpcIndex = -1;
    let found = false;
    let minErr = Infinity;
    let minErrIdx = startIdx;

    for (let i = 0; i < numRpcUrls; i++) {
      const idx = (startIdx + i) % numRpcUrls;
      const status = rpcStatus[chain][idx];
      if (status.backoffUntil > now) continue;
      if (status.skipCount > 0) {
        status.skipCount--;
      }
      if (status.skipCount === 0 && !found) {
        usedRpcIndex = idx;
        found = true;
      }
      if (status.errorCount < minErr) {
        minErr = status.errorCount;
        minErrIdx = idx;
      }
    }

    if (!found) {
      usedRpcIndex = minErrIdx;
    }

    const usedRpc = rpcUrls[chain][usedRpcIndex];
    rpcRoundRobinIndex[chain] = (usedRpcIndex + 1) % numRpcUrls;

    return { usedRpc, usedRpcIndex, totalRpcs: numRpcUrls };
  }

  return {
    markRpcError(rpcIndex, skipFor) {
      markRpcError(rpcIndex, skipFor ?? rpcSkipCountRetryable);
    },
    markRpcSuccess(rpcIndex) {
      markRpcSuccess(rpcIndex);
    },
    logRpcScores() {
      logRpcScores();
    },
    getStatusLine() {
      return getStatusLine();
    },
    selectRpc() {
      return selectRpcUrl();
    },
  };
}

module.exports = { createRpcManager };
