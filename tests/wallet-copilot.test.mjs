import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContextDigest,
  generateLocalAssistantResponse,
  normalizePreparedWalletAction
} from "../lib/wallet-copilot.js";

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const FULL_HASH = `0x${"a".repeat(64)}`;

function walletContext() {
  return {
    wallet: {
      address: "0x9999999999999999999999999999999999999999",
      connected: true,
      chainId: 5042002,
      network: "Arc Testnet",
      onArc: true,
      balanceStatus: "ready"
    },
    portfolio: {
      status: "ready",
      assets: [
        { symbol: "USDC", balance: "25", balanceValue: 25, balanceLabel: "25 USDC" },
        { symbol: "EURC", balance: "2", balanceValue: 2, balanceLabel: "2 EURC" }
      ]
    },
    activity: {
      status: "ready",
      items: [
        {
          type: "Sent",
          kind: "sent",
          amount: "3 USDC",
          counterparty: RECIPIENT,
          summary: `Sent 3 USDC to ${RECIPIENT} in ${FULL_HASH}`,
          txHash: FULL_HASH,
          txHashShort: "0xaaaaaa…aaaa",
          timeLabel: "2m ago",
          status: "Confirmed"
        }
      ]
    }
  };
}

test("local intelligence prepares a validated USDC send", () => {
  const result = generateLocalAssistantResponse({
    question: `Send 5 USDC to ${RECIPIENT}`,
    messages: [],
    context: walletContext()
  });

  assert.equal(result.mode, "local-intelligence");
  assert.equal(result.actions.length, 1);
  assert.deepEqual(result.actions[0].args, {
    recipient: RECIPIENT,
    amount: "5"
  });
  assert.equal(result.actions[0].tool, "prepare_send");
  assert.match(result.answer, /review the full address/i);
});

test("local intelligence carries action details through a follow-up", () => {
  const result = generateLocalAssistantResponse({
    question: RECIPIENT,
    messages: [
      { role: "user", content: "Send 4 USDC" },
      { role: "assistant", content: "What recipient should receive it?" }
    ],
    context: walletContext()
  });

  assert.equal(result.actions[0]?.tool, "prepare_send");
  assert.equal(result.actions[0]?.args.amount, "4");
  assert.equal(result.actions[0]?.args.recipient, RECIPIENT);
});

test("local intelligence prepares swaps and infers the active bridge source", () => {
  const swap = generateLocalAssistantResponse({
    question: "Swap 10 USDC to EURC at 0.5%",
    messages: [],
    context: walletContext()
  });
  const bridge = generateLocalAssistantResponse({
    question: "Bridge 6 USDC to Base",
    messages: [],
    context: walletContext()
  });

  assert.deepEqual(swap.actions[0]?.args, {
    tokenIn: "USDC",
    tokenOut: "EURC",
    amount: "10",
    slippageBps: 50
  });
  assert.deepEqual(bridge.actions[0]?.args, {
    sourceNetwork: "arc",
    destinationNetwork: "base-sepolia",
    amount: "6"
  });
});

test("incomplete addresses never become prepared transactions", () => {
  const result = generateLocalAssistantResponse({
    question: "Send 2 USDC to 0x123",
    messages: [],
    context: walletContext()
  });

  assert.equal(result.actions.some((action) => action.tool === "prepare_send"), false);
  assert.match(result.answer, /full 42-character EVM address/i);
});

test("prepared action validation rejects unsafe or malformed model output", () => {
  assert.equal(
    normalizePreparedWalletAction({
      tool: "prepare_send",
      args: { recipient: "0x123", amount: "5" }
    }),
    null
  );
  assert.equal(
    normalizePreparedWalletAction({
      tool: "prepare_bridge",
      args: { sourceNetwork: "arc", destinationNetwork: "arc", amount: "5" }
    }),
    null
  );
  assert.equal(
    normalizePreparedWalletAction({
      tool: "prepare_swap",
      args: {
        tokenIn: "USDC",
        tokenOut: "USDC",
        amount: "5",
        slippageBps: 100
      }
    }),
    null
  );
});

test("cloud digest excludes the connected address and full transaction identifiers", () => {
  const digestText = JSON.stringify(buildContextDigest(walletContext()));

  assert.equal(digestText.includes("0x9999999999999999999999999999999999999999"), false);
  assert.equal(digestText.includes(RECIPIENT), false);
  assert.equal(digestText.includes(FULL_HASH), false);
  assert.match(digestText, /\[wallet address\]/);
  assert.match(digestText, /\[transaction hash\]/);
});
