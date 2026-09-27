import assert from "node:assert/strict";
import test from "node:test";
import { handleWalletChat } from "../lib/chat-api.js";

const recipient = "0x1111111111111111111111111111111111111111";

function environment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function response() {
  return {
    code: 0,
    payload: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function request(id, body = {}) {
  return {
    method: "POST",
    headers: {},
    socket: { remoteAddress: id },
    body: { question: "Help with my wallet", cloudConsent: true, consentProvider: "groq", ...body }
  };
}

function completion(message, finishReason = "stop") {
  return Response.json({
    id: "test-completion",
    object: "chat.completion",
    created: 1,
    model: "openai/gpt-oss-120b",
    choices: [
      { index: 0, message: { role: "assistant", ...message }, finish_reason: finishReason }
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
  });
}

test("Vercel credentials cannot enable or call a paid model when Groq is unconfigured", async (t) => {
  environment(t, { GROQ_API_KEY: " ", VERCEL: "1", AI_GATEWAY_API_KEY: "unused-test-key" });
  const network = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No network request is allowed without a Groq key");
  });
  const res = response();
  await handleWalletChat({ ...request("groq-status"), method: "GET" }, res);
  assert.equal(res.code, 200);
  assert.equal(res.payload.configured, false);
  assert.equal(res.payload.setupRequired, true);
  assert.equal(res.payload.provider, "groq");
  await handleWalletChat(request("groq-missing"), res);
  assert.equal(res.code, 503);
  assert.equal(res.payload.code, "ai_setup_required");
  assert.deepEqual(res.payload.actions, []);
  assert.equal(network.mock.callCount(), 0);
});

test("stale consent for the previous provider cannot send data to Groq", async (t) => {
  environment(t, { GROQ_API_KEY: "test-groq-key" });
  const network = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No network request is allowed without provider consent");
  });
  const res = response();
  await handleWalletChat(request("groq-old-consent", { consentProvider: undefined }), res);
  assert.equal(res.code, 403);
  assert.equal(network.mock.callCount(), 0);
});

test("the real Groq SDK transports wallet tools and returns a review without signing", async (t) => {
  environment(t, { GROQ_API_KEY: "test-groq-key", AI_GATEWAY_API_KEY: "never-use-this-key" });
  const requests = [];
  const messages = [
    {
      tool_calls: [
        { id: "read", type: "function", function: { name: "read_wallet", arguments: "{}" } }
      ]
    },
    {
      tool_calls: [
        {
          id: "prepare",
          type: "function",
          function: {
            name: "prepare_send",
            arguments: JSON.stringify({ recipient, amount: "0.000001" })
          }
        }
      ]
    },
    { content: "Review the prepared transfer. Your wallet must approve it." }
  ];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-groq-key");
    requests.push(JSON.parse(init.body));
    assert.ok(messages.length, "The agent must stop after the final response");
    return completion(messages.shift(), messages.length ? "tool_calls" : "stop");
  });
  const res = response();
  await handleWalletChat(
    request("groq-tools", {
      question: `Prepare 0.000001 USDC to ${recipient}`,
      context: {
        wallet: { connected: true },
        portfolio: { assets: [{ symbol: "USDC", balanceLabel: "3 USDC" }] }
      }
    }),
    res
  );
  assert.equal(res.code, 200);
  assert.equal(res.payload.mode, "ai-copilot");
  assert.equal(res.payload.provider, "groq");
  assert.equal(res.payload.model, "openai/gpt-oss-120b");
  assert.equal(requests.length, 3);
  assert.equal(requests[0].model, "openai/gpt-oss-120b");
  assert.equal(requests[0].parallel_tool_calls, false);
  assert.equal(requests[0].reasoning_effort, "low");
  assert.match(JSON.stringify(requests[1].messages), /3 USDC/);
  const prepared = JSON.parse(
    requests[2].messages.find((message) => message.tool_call_id === "prepare").content
  );
  assert.equal(prepared.submitted, false);
  assert.equal(prepared.signed, false);
  assert.deepEqual(res.payload.actions[0].args, { recipient, amount: "0.000001" });
  assert.equal(res.payload.actions.length, 1);
  assert.equal(JSON.stringify(res.payload).includes("test-groq-key"), false);
});

test("free quota errors stop without retries, paid fallback or leaking provider error bodies", async (t) => {
  environment(t, { GROQ_API_KEY: "test-groq-key", AI_GATEWAY_API_KEY: "unused-test-key" });
  const network = t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(String(url), "https://api.groq.com/openai/v1/chat/completions");
    return Response.json(
      {
        error: {
          message: "Sensitive prompt or gsk_test_secret",
          type: "tokens",
          code: "rate_limit_exceeded"
        }
      },
      { status: 429, headers: { "retry-after": "42" } }
    );
  });
  const log = t.mock.method(console, "warn", () => {});
  const res = response();
  await handleWalletChat(request("groq-quota"), res);
  assert.equal(res.code, 429);
  assert.equal(res.headers["Retry-After"], "42");
  assert.match(res.payload.error, /free AI usage limit/);
  assert.deepEqual(res.payload.actions, []);
  assert.equal(network.mock.callCount(), 1);
  assert.doesNotMatch(
    JSON.stringify(log.mock.calls.map((call) => call.arguments)),
    /Sensitive|gsk_test_secret/
  );
  assert.doesNotMatch(JSON.stringify(res.payload), /Sensitive|gsk_test_secret/);
});
