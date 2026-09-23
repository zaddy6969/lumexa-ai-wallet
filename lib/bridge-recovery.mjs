// A checkpoint is local to this wallet and environment. It contains public
// transaction data, never a signing key or wallet provider.
export function recoveryKey(mode, address) {
  return `lumexa:bridge:v1:${mode}:${String(address || "").toLowerCase()}`;
}

export function serializeCheckpoint(value) {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? { __lumexaBigInt: item.toString() } : item
  );
}

export function parseCheckpoint(raw, address, allowedChainIds) {
  try {
    const value = JSON.parse(raw, (_key, item) =>
      item && typeof item === "object" && /^\d+$/.test(item.__lumexaBigInt || "")
        ? BigInt(item.__lumexaBigInt)
        : item
    );
    if (value?.address?.toLowerCase() !== address?.toLowerCase()) return null;
    if (!allowedChainIds.includes(value.sourceId) || !allowedChainIds.includes(value.destinationId))
      return null;
    if (value.sourceId === value.destinationId || !Array.isArray(value.result?.steps)) return null;
    return value;
  } catch {
    return null;
  }
}

export function canResumeBridge(result) {
  // Only resume a completed burn. Starting another burn could duplicate the transfer.
  return (
    result?.state !== "success" &&
    Boolean(
      result?.provider &&
      result?.source &&
      result?.destination &&
      result.steps?.some(
        (step) => /^(burn|transfer)$/i.test(step.name) && step.state === "success" && step.txHash
      )
    )
  );
}

export function bridgeTransferStep(result) {
  return (
    result?.steps?.find((step) => /^(burn|transfer)$/i.test(step.name) && step.txHash) ||
    result?.steps?.find((step) => step.txHash) ||
    null
  );
}
