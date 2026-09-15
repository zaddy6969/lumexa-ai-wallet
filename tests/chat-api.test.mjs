import assert from "node:assert/strict";
import test from "node:test";

process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
process.env.AI_GATEWAY_MODEL = "openai/gpt-6-astra";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_KEY;
delete process.env.AI_API_KEY;

const { handleWalletChat } = await import("../lib/chat-api.js");
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const RECIPIENT = "0x1111111111111111111111111111111111111111";

function walletContext() {
  return {
    wallet: {
      connected: true,
      chainId: 5042002,
      network: "Arc Testnet",
      onArc: true,
      balanceStatus: "ready"
    },
    portfolio: {
      status: "ready",
      assets: [{ symbol: "USDC", balance: "25", balanceLabel: "25 USDC" }]
    },
    activity: {
      status: "ready",
      items: [
        {
          type: "Sent",
          kind: "sent",
          amount: "3 USDC",
          counterparty: RECIPIENT,
          status: "Confirmed",
          timeLabel: "2m ago"
        }
      ]
    }
  };
}

function request(question) {
  return {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "x-forwarded-for": `test-${Math.random()}`
    },
    body: { question, messages: [], context: walletContext() }
  };
}

function responseRecorder() {
  return {
    body: null,
    headers: {},
    statusCode: 200,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    }
  };
}

test("wallet analysis always calls the configured real model", async () => {
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: "openai/gpt-6-astra",
        output_text: "Your visible Arc Testnet balance is 25 USDC.",
        output: []
      })
    };
  };

  const res = responseRecorder();
  await handleWalletChat(request("Analyze my USDC balance"), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, "ai-agent");
  assert.equal(res.body.provider, "vercel-ai-gateway");
  assert.equal(requestBody.model, "openai/gpt-6-astra");
  assert.equal(requestBody.reasoning.effort, "high");
  assert.ok(requestBody.tools.some((tool) => tool.name === "repeat_latest_transaction"));
  assert.deepEqual(requestBody.providerOptions.gateway.models, ["openai/gpt-5.6-sol"]);
});

test("model repeat tool resolves exact private transaction details locally", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: "openai/gpt-6-astra",
      output: [
        {
          type: "function_call",
          name: "repeat_latest_transaction",
          call_id: "call_repeat",
          arguments: "{}"
        }
      ]
    })
  });

  const res = responseRecorder();
  await handleWalletChat(request("Repeat my transaction"), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, "ai-agent");
  assert.equal(res.body.actions[0]?.tool, "prepare_send");
  assert.deepEqual(res.body.actions[0]?.args, { recipient: RECIPIENT, amount: "3" });
  assert.match(res.body.answer, /nothing has been submitted/i);
});

test("provider failures are exposed instead of disguised as local AI", async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { message: "provider unavailable" } })
  });

  const res = responseRecorder();
  await handleWalletChat(request("What is my latest transaction?"), res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.mode, "unavailable");
  assert.equal(res.body.code, "AI_PROVIDER_UNAVAILABLE");
  assert.equal("answer" in res.body, false);
});
