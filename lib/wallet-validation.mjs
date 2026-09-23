export const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function isEvmAddress(value) {
  return EVM_ADDRESS_PATTERN.test(String(value || ""));
}

export function isZeroEvmAddress(value) {
  return String(value || "").toLowerCase() === ZERO_EVM_ADDRESS;
}

export function normalizeDecimal(value, decimals = 6) {
  const safeDecimals = Math.max(0, Math.min(Number(decimals) || 0, 18));
  const cleaned = String(value || "").replace(/[^\d.]/g, "");
  const [whole = "", ...fractionParts] = cleaned.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");

  if (!fractionParts.length) return normalizedWhole;
  return `${normalizedWhole || "0"}.${fractionParts.join("").slice(0, safeDecimals)}`;
}

export function parsePositiveDecimal(value, decimals = 6) {
  const raw = String(value || "").trim();
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18 ||
    raw.length > 80 ||
    !/^\d*(?:\.\d*)?$/.test(raw) ||
    !raw
  ) {
    return { valid: false, normalized: "", units: 0n, error: "Enter a valid amount." };
  }
  if ((raw.split(".")[1] || "").length > decimals) {
    return {
      valid: false,
      normalized: raw,
      units: 0n,
      error: `Use no more than ${decimals} decimal places.`
    };
  }
  const normalized = normalizeDecimal(value, decimals);
  if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) {
    return { valid: false, normalized, units: 0n, error: "Enter a valid amount." };
  }

  const [whole, fraction = ""] = normalized.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0");
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFraction || "0");

  if (units >= 2n ** 256n) {
    return { valid: false, normalized, units: 0n, error: "Amount is too large." };
  }
  if (units <= 0n) {
    return { valid: false, normalized, units, error: "Amount must be greater than zero." };
  }

  return { valid: true, normalized, units, error: "" };
}

export function createEip681TokenRequest({
  tokenAddress,
  chainId,
  recipient,
  amount,
  decimals = 6
}) {
  const parsed = parsePositiveDecimal(amount, decimals);
  if (
    !isEvmAddress(tokenAddress) ||
    isZeroEvmAddress(tokenAddress) ||
    !Number.isSafeInteger(Number(chainId)) ||
    Number(chainId) <= 0 ||
    !isEvmAddress(recipient) ||
    isZeroEvmAddress(recipient) ||
    !parsed.valid
  )
    return "";

  return `ethereum:${tokenAddress}@${chainId}/transfer?address=${encodeURIComponent(recipient)}&uint256=${parsed.units.toString()}`;
}

export function cleanNote(value, maxLength = 80) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trimStart()
    .slice(0, maxLength);
}
