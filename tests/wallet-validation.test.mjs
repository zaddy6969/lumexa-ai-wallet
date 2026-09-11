import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanNote,
  createEip681TokenRequest,
  isEvmAddress,
  isZeroEvmAddress,
  normalizeDecimal,
  parsePositiveDecimal
} from "../lib/wallet-validation.mjs";

test("normalizes decimal input without floating-point math", () => {
  assert.equal(normalizeDecimal("0012.3456789", 6), "12.345678");
  assert.equal(normalizeDecimal("1.2.3", 6), "1.23");
  assert.equal(normalizeDecimal("$ 4,200.50", 6), "4200.50");
});

test("parses positive token amounts to exact integer units", () => {
  assert.deepEqual(parsePositiveDecimal("25.123456", 6), {
    valid: true,
    normalized: "25.123456",
    units: 25123456n,
    error: ""
  });
  assert.equal(parsePositiveDecimal("0", 6).valid, false);
  assert.equal(parsePositiveDecimal("", 6).valid, false);
});

test("builds an EIP-681 ERC-20 request only for valid positive amounts", () => {
  const uri = createEip681TokenRequest({
    tokenAddress: "0x3600000000000000000000000000000000000000",
    chainId: 5042002,
    recipient: "0x1111111111111111111111111111111111111111",
    amount: "1.25"
  });
  assert.match(uri, /uint256=1250000$/);
  assert.equal(
    createEip681TokenRequest({ tokenAddress: "x", chainId: 1, recipient: "y", amount: "-1" }),
    ""
  );
  assert.equal(
    createEip681TokenRequest({
      tokenAddress: "0x3600000000000000000000000000000000000000",
      chainId: 5042002,
      recipient: "0x0000000000000000000000000000000000000000",
      amount: "1"
    }),
    ""
  );
});

test("rejects the zero address and sanitizes request notes", () => {
  assert.equal(isEvmAddress("0x1111111111111111111111111111111111111111"), true);
  assert.equal(isEvmAddress("0x1111"), false);
  assert.equal(isZeroEvmAddress("0x0000000000000000000000000000000000000000"), true);
  assert.equal(cleanNote("  Invoice\n\t 42  "), "Invoice 42 ");
});
