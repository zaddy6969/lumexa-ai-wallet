import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRecipient,
  parseTransferAmount,
  arcFeeEstimate,
  maxSendUnits,
  assertReview,
  assertWalletIdentity,
  minimumSwapOutput,
  guardedWalletProvider
} from "../lib/transaction-safety.mjs";
import {
  recoveryKey,
  serializeCheckpoint,
  parseCheckpoint,
  canResumeBridge,
  bridgeTransferStep
} from "../lib/bridge-recovery.mjs";
import { normalizePreparedWalletAction } from "../lib/wallet-copilot.js";
import { resolveNaturalWalletAgent } from "../lib/natural-wallet-agent.js";
import { ARC_NETWORK_MODE, arcActiveChain, APP_KIT_EVM_CHAIN_OPTIONS } from "../lib/arc-chain.js";
const address = "0x1111111111111111111111111111111111111111";
const hash = `0x${"a".repeat(64)}`;

test("money validation rejects precision loss, exponent notation, zero recipients and overflow", () => {
  for (const value of ["1.0000001", "1e3", "-2", "1.2.3", "Infinity", "9".repeat(81)])
    assert.throws(() => parseTransferAmount(value));
  assert.equal(parseTransferAmount("0.000001").units, 1n);
  assert.throws(() => assertRecipient(`0x${"0".repeat(40)}`));
  assert.doesNotThrow(() => assertRecipient(address));
  assert.equal(
    normalizePreparedWalletAction({
      tool: "prepare_send",
      args: { recipient: address, amount: "0.0000001" }
    }),
    null
  );
});

test("Arc MAX reserves a padded fee cap from the same USDC balance with exact units", () => {
  const fee = arcFeeEstimate(21000n, 1n);
  assert.equal(fee.gasLimit, 25200n);
  assert.equal(fee.maxFeePerGas, 40000000000n);
  const units = maxSendUnits(1000000000000000000n, fee.fee);
  assert.equal(units, 998992n);
  assert.ok(units * 1000000000000n + fee.fee <= 1000000000000000000n);
  assert.equal(maxSendUnits(0n, fee.fee), 0n);
});

test("review cannot survive changed account, route, amount or expiration", () => {
  const review = { identity: "wallet:route:amount", createdAt: 1000 };
  assert.doesNotThrow(() => assertReview(review, review.identity, 2000));
  assert.throws(() => assertReview(review, "different", 2000));
  assert.throws(() => assertReview(review, review.identity, 62000));
  assert.throws(() => assertReview({ identity: review.identity }, review.identity));
});

test("provider checks the actual account and chain immediately before signing", async () => {
  let chain = 5042;
  let owner = address;
  let sends = 0;
  let submitted = "";
  const provider = {
    request: async ({ method }) => {
      if (method === "eth_chainId") return `0x${chain.toString(16)}`;
      if (method === "eth_accounts") return [owner];
      if (method === "eth_sendTransaction") {
        sends++;
        return hash;
      }
    }
  };
  const guarded = guardedWalletProvider(provider, address, [5042], (value) => {
    submitted = value;
  });
  await assertWalletIdentity(provider, address, 5042);
  chain = 5042002;
  await assert.rejects(
    guarded.request({ method: "eth_sendTransaction", params: [{ from: address }] })
  );
  chain = 5042;
  owner = `0x${"2".repeat(40)}`;
  await assert.rejects(
    guarded.request({ method: "eth_sendTransaction", params: [{ from: address }] })
  );
  assert.equal(sends, 0);
  owner = address;
  await guarded.request({ method: "eth_sendTransaction", params: [{ from: address }] });
  assert.equal(submitted, hash);
  assert.equal(sends, 1);
});

test("swap minimum rounds down in token units and rejects unsafe slippage", () => {
  assert.equal(minimumSwapOutput({ estimatedOutput: { amount: "10.123456" } }, 6, 50), "10.072838");
  assert.throws(() => minimumSwapOutput({ estimatedOutput: { amount: "1" } }, 6, 10001));
});

test("bridge checkpoints isolate wallets and networks and resume only a confirmed burn", () => {
  const result = {
    state: "error",
    provider: "CCTPv2",
    source: {},
    destination: {},
    steps: [
      { name: "approve", state: "success", txHash: `0x${"b".repeat(64)}` },
      { name: "burn", state: "success", txHash: hash, data: { value: 10n } }
    ]
  };
  assert.equal(canResumeBridge({ ...result, steps: result.steps.slice(0, 1) }), false);
  assert.equal(canResumeBridge(result), true);
  assert.equal(canResumeBridge({ ...result, state: "success" }), false);
  assert.equal(bridgeTransferStep(result).txHash, hash);
  const raw = serializeCheckpoint({
    address,
    sourceId: 5042,
    destinationId: 8453,
    amount: "1",
    result
  });
  assert.equal(parseCheckpoint(raw, address, [5042, 8453]).result.steps[1].data.value, 10n);
  assert.equal(parseCheckpoint(raw, address, [5042002, 84532]), null);
  assert.equal(parseCheckpoint(raw, `0x${"2".repeat(40)}`, [5042, 8453]), null);
  assert.notEqual(recoveryKey("mainnet", address), recoveryKey("testnet", address));
});

test("natural assistant refuses the other environment and never bypasses action validation", () => {
  const context = {
    wallet: {
      connected: true,
      address,
      chainId: arcActiveChain.id,
      network: arcActiveChain.name,
      onArc: true
    }
  };
  const other = ARC_NETWORK_MODE === "mainnet" ? "testnet" : "mainnet";
  const response = resolveNaturalWalletAgent({
    question: `Bridge 1 USDC from Arc ${other} to Base`,
    context,
    messages: []
  });
  assert.equal(response.actions?.length || 0, 0);
  const zero = resolveNaturalWalletAgent({
    question: `send 1 USDC to 0x${"0".repeat(40)}`,
    context,
    messages: []
  });
  assert.equal(zero?.actions?.filter((action) => action.tool === "prepare_send").length || 0, 0);
  assert.ok(
    APP_KIT_EVM_CHAIN_OPTIONS.every((chain) =>
      ARC_NETWORK_MODE === "mainnet"
        ? !chain.name.includes("Sepolia")
        : chain.name.includes("Testnet") || chain.name.includes("Sepolia")
    )
  );
});

test("a confirmed source approval never overwrites bridge delivery status", async () => {
  const { createWalletActionRecord, mergeActivityFeedItems, mapLiveActivityToFeedItem } =
    await import("../lib/local-activity.js");
  const pending = createWalletActionRecord({
    walletAddress: address,
    type: "Bridge",
    kind: "bridge",
    status: "Submitted",
    txHash: hash,
    chainId: arcActiveChain.id
  });
  const sourceReceipt = mapLiveActivityToFeedItem({
    type: "Approval",
    kind: "approval",
    status: "Confirmed",
    txHash: hash,
    chainId: arcActiveChain.id
  });
  assert.equal(mergeActivityFeedItems([pending], [sourceReceipt])[0].status, "Submitted");
  const completed = { ...pending, status: "Confirmed" };
  assert.equal(mergeActivityFeedItems([pending, completed], [])[0].status, "Confirmed");
  assert.equal(mapLiveActivityToFeedItem({ txHash: hash }).status, "Unknown");
});
