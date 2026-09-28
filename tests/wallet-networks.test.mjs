import assert from "node:assert/strict";
import test from "node:test";
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  ARC_NETWORK_MODE,
  WALLET_CONNECTION_CHAINS,
  MULTICHAIN_WALLET_CHAINS,
  APP_KIT_EVM_CHAIN_OPTIONS,
  arcTestnetChain,
  arcTokensForChain
} from "../lib/arc-chain.js";
import { summarizeNetworkBalances } from "../lib/wallet-balance-totals.js";
import { switchWalletNetwork } from "../lib/wallet-network.js";

// Adding a connection option must not introduce a mainnet/testnet bridge route.
test("Arc Testnet is selectable while transaction routes stay in their environment", () => {
  assert.ok(WALLET_CONNECTION_CHAINS.some((chain) => chain.id === ARC_TESTNET_CHAIN_ID));
  assert.equal(
    new Set(WALLET_CONNECTION_CHAINS.map((chain) => chain.id)).size,
    WALLET_CONNECTION_CHAINS.length
  );
  assert.ok(
    MULTICHAIN_WALLET_CHAINS.every(
      (chain) => Boolean(chain.testnet) === (ARC_NETWORK_MODE === "testnet")
    )
  );
  assert.ok(
    APP_KIT_EVM_CHAIN_OPTIONS.every((option) =>
      MULTICHAIN_WALLET_CHAINS.some((chain) => chain.id === option.id)
    )
  );
  assert.equal(arcTestnetChain.nativeCurrency.decimals, 18);
  const testTokens = arcTokensForChain(ARC_TESTNET_CHAIN_ID);
  assert.ok(testTokens.length > 0);
  assert.ok(testTokens.every((token) => token.priceUsd === null));
  assert.notEqual(
    testTokens.find((token) => token.symbol === "EURC").address,
    arcTokensForChain(ARC_MAINNET_CHAIN_ID).find((token) => token.symbol === "EURC").address
  );
});

test("testnet funds never inflate mainnet USDC, asset counts or monetary totals", () => {
  const networks = [
    { status: "ready", testnet: false, usdcBalance: 12, assetCount: 2, totalReferenceUsd: 25 },
    {
      status: "ready",
      testnet: true,
      usdcBalance: 900000,
      assetCount: 3,
      totalReferenceUsd: 900000
    },
    {
      status: "unavailable",
      testnet: false,
      usdcBalance: 500,
      assetCount: 1,
      totalReferenceUsd: 500
    }
  ];
  assert.deepEqual(summarizeNetworkBalances(networks, "mainnet"), {
    totalUsdc: 12,
    totalAssetCount: 2,
    totalReferenceUsd: 25,
    partial: true
  });
  assert.deepEqual(summarizeNetworkBalances(networks, "testnet"), {
    totalUsdc: 900000,
    totalAssetCount: 3,
    totalReferenceUsd: null,
    partial: true
  });
});

test("choosing Arc Testnet switches the provider chain without sending a transaction", async () => {
  let active = ARC_MAINNET_CHAIN_ID;
  const methods = [];
  const provider = {
    request: async ({ method }) => {
      methods.push(method);
      assert.equal(method, "eth_chainId");
      return `0x${active.toString(16)}`;
    }
  };
  const result = await switchWalletNetwork({
    connector: { getProvider: async () => provider },
    chain: arcTestnetChain,
    switchChainAsync: async ({ chainId }) => {
      assert.equal(chainId, ARC_TESTNET_CHAIN_ID);
      active = chainId;
    }
  });
  assert.equal(result.chainId, ARC_TESTNET_CHAIN_ID);
  assert.ok(methods.length > 0);
});

test("a rejected network switch preserves the previous chain", async () => {
  let reads = 0;
  const provider = {
    request: async ({ method }) => {
      reads++;
      assert.equal(method, "eth_chainId");
      return `0x${ARC_MAINNET_CHAIN_ID.toString(16)}`;
    }
  };
  await assert.rejects(
    switchWalletNetwork({
      connector: { getProvider: async () => provider },
      chain: arcTestnetChain,
      switchChainAsync: async () => {
        throw Object.assign(new Error("Rejected"), { code: 4001 });
      }
    }),
    /Rejected/
  );
  assert.equal(reads, 1);
});
