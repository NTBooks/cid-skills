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
        console.log(
          `Marking RPC error - isRetryable: ${isRetryable}, skipFor: ${skipFor}, attempt: ${attempt}`
        );
        courierInstance.markRpcError(skipFor);
      }

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      if (courierInstance?.switchRpc) {
        courierInstance.switchRpc();
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.log(
        `RPC call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      console.log(`Retrying now (attempt ${attempt + 2}/${maxRetries + 1})...`);
    }
  }

  throw lastError;
}

module.exports = { isRetryableError, withRetry };
