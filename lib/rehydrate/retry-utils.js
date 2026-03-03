const { c } = require('./colors');

function isRetryableError(error, config) {
  const errorMessage =
    (error.message?.toLowerCase() || '') +
    (error.details?.toLowerCase() || '') +
    (error.cause?.details?.toLowerCase() || '') +
    (error.shortMessage?.toLowerCase() || '');
  const errorStatus = error.status;

  if (errorStatus === 429) {
    return true;
  }

  for (const pattern of config.nonRetryableErrorPatterns) {
    if (errorMessage.includes(pattern)) {
      return false;
    }
  }

  for (const pattern of config.retryableErrorPatterns) {
    if (errorMessage.includes(pattern)) {
      return true;
    }
  }

  return true;
}

async function withRetry(operation, courierInstance, config) {
  const maxRetries = config.maxRetries;
  const baseDelay = config.retryBaseDelay;
  const rpcSkipCountRetryable = config.rpcSkipCountRetryable;
  const rpcSkipCountNonRetryable = config.rpcSkipCountNonRetryable;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      if (courierInstance?.markRpcSuccess) {
        courierInstance.markRpcSuccess();
      }
      return result;
    } catch (error) {
      lastError = error;
      const isRetryable = isRetryableError(error, config);

      if (courierInstance?.markRpcError) {
        const skipFor = isRetryable
          ? rpcSkipCountRetryable
          : rpcSkipCountNonRetryable;
        const ts = new Date().toISOString().slice(11, 19);
        console.log(
          `${c.dim}[${ts}]${c.reset} ${c.red}RPC error${c.reset} (attempt ${attempt + 1}/${maxRetries + 1}) ${c.dim}- retryable: ${isRetryable}, skipFor: ${skipFor}${c.reset}`
        );
        courierInstance.markRpcError(skipFor);
      }

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      const ts = new Date().toISOString().slice(11, 19);
      let switched = false;
      if (courierInstance?.switchRpc) {
        switched = courierInstance.switchRpc();
      }
      if (switched) {
        console.log(`${c.dim}[${ts}]${c.reset} ${c.yellow}Waiting ${delay}ms before next attempt...${c.reset}`);
      } else {
        console.log(`${c.dim}[${ts}]${c.reset} ${c.yellow}Waiting ${delay}ms before retrying same RPC...${c.reset}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      const ts2 = new Date().toISOString().slice(11, 19);
      console.log(`${c.dim}[${ts2}]${c.reset} ${c.cyan}Retrying${c.reset} (attempt ${attempt + 2}/${maxRetries + 1})...`);
    }
  }

  throw lastError;
}

module.exports = { isRetryableError, withRetry };
