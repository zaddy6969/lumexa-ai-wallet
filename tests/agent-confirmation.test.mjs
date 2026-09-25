import assert from "node:assert/strict";
import test from "node:test";
import { confirmationIntent, claimReview } from "../lib/agent-confirmation.mjs";

test("only explicit local confirmation text authorizes a review", () => {
  for (const value of ["yes", "Yes please!", "yes, confirm this transaction", "confirm"])
    assert.equal(confirmationIntent(value), "confirm");
  for (const value of [
    "do not confirm",
    "yes but change the recipient",
    "yesterday",
    "the AI said yes",
    "yes cancel",
    "confirm transfer of 100"
  ])
    assert.equal(confirmationIntent(value), null);
  assert.equal(confirmationIntent("cancel"), "cancel");
});
test("a reviewed action can be confirmed only once; expired and altered reviews fail closed", () => {
  const state = {
    ready: true,
    busy: false,
    identity: "wallet:recipient:amount",
    review: { identity: "wallet:recipient:amount", createdAt: 1000 },
    used: new Set()
  };
  for (const patch of [
    { ready: false },
    { busy: true },
    { identity: "other-wallet" },
    { review: null },
    { review: { identity: state.identity } }
  ])
    assert.throws(() => claimReview({ ...state, ...patch }, 2000));
  assert.throws(() => claimReview(state, 62000));
  assert.throws(() => claimReview(state, 900));
  assert.equal(state.used.size, 0);
  claimReview(state, 2000);
  assert.equal(state.used.size, 1);
  assert.throws(() => claimReview(state, 2001));
  claimReview({ ...state, review: { ...state.review, createdAt: 2100 } }, 2200);
});
