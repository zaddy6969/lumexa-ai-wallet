import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { createWalletAgent, handleWalletChat } from "../lib/chat-api.js";
const recipient = "0x1111111111111111111111111111111111111111";
const usage = { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } };
const output = (content, finish = "tool-calls") => ({
  content,
  finishReason: { unified: finish },
  usage,
  warnings: []
});
const call = (id, name, args) => ({
  type: "tool-call",
  toolCallId: id,
  toolName: name,
  input: JSON.stringify(args)
});
test("AI SDK runs real tool orchestration and preserves exact recipient/amount without submitting funds", async () => {
  const actions = [];
  const model = new MockLanguageModelV4({
    doGenerate: [
      output([call("read", "read_wallet", {})]),
      output([call("prepare", "prepare_send", { recipient, amount: "0.000001" })]),
      output([{ type: "text", text: "Review the prepared transfer." }], "stop")
    ]
  });
  const result = await createWalletAgent({
    context: {
      wallet: { connected: true },
      portfolio: { assets: [{ symbol: "USDC", balanceLabel: "3 USDC" }] }
    },
    actions,
    model
  }).generate({ prompt: `Send 0.000001 USDC to ${recipient}` });
  assert.equal(model.doGenerateCalls.length, 3);
  assert.equal(result.text, "Review the prepared transfer.");
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].args, { recipient, amount: "0.000001" });
  assert.equal(result.steps[1].toolResults[0].output.submitted, false);
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt), /3 USDC/);
});
test("unsafe model parameters cannot create an action and multiple calls cannot queue payments", async () => {
  const actions = [];
  const model = new MockLanguageModelV4({
    doGenerate: [
      output([call("bad", "prepare_send", { recipient: "0x123", amount: "999" })]),
      output([
        call("good", "prepare_send", { recipient, amount: "1" }),
        call("duplicate", "prepare_send", { recipient, amount: "2" })
      ]),
      output([{ type: "text", text: "One review is prepared." }], "stop")
    ]
  });
  await createWalletAgent({ context: {}, actions, model }).generate({
    prompt: "Prepare one payment"
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].args.amount, "1");
});
test("AI API requires consent and reports missing configuration instead of a scripted answer", async () => {
  const saved = Object.fromEntries(
    ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "VERCEL"].map((key) => [key, process.env[key]])
  );
  for (const key of Object.keys(saved)) delete process.env[key];
  const res = {
    code: 0,
    payload: null,
    setHeader() {},
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    }
  };
  const req = {
    method: "POST",
    headers: {},
    socket: { remoteAddress: "test-ai" },
    body: { question: "Explain my balance", cloudConsent: false }
  };
  try {
    await handleWalletChat(req, res);
    assert.equal(res.code, 403);
    req.body.cloudConsent = true;
    await handleWalletChat(req, res);
    assert.equal(res.code, 503);
    assert.equal(res.payload.answer, undefined);
  } finally {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
