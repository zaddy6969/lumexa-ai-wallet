// Confirmation is interpreted locally, never delegated to model output.
export function confirmationIntent(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  if (
    /^(yes|yes please|yes,? confirm(?: this transaction)?|confirm(?: this transaction)?)$/.test(
      text
    )
  )
    return "confirm";
  if (/^(no|cancel|cancel(?: this| the)? transaction|stop)$/.test(text)) return "cancel";
  return null;
}

export function claimReview({ ready, busy, review, identity, used }, now = Date.now()) {
  if (busy || !ready || !review)
    throw new Error("Wait for the live transaction review before confirming.");
  if (
    !Number.isFinite(review.createdAt) ||
    review.identity !== identity ||
    now - review.createdAt > 60_000 ||
    review.createdAt > now
  )
    throw new Error("This review expired or changed. Refresh the review, then confirm again.");
  const key = `${identity}:${review.createdAt}`;
  if (used.has(key))
    throw new Error(
      "This confirmation has already been used. Check the transaction status before retrying."
    );
  used.add(key);
  return key;
}
