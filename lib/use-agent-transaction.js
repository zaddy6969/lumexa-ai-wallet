import { useEffect, useImperativeHandle, useRef } from "react";
import { claimReview } from "./agent-confirmation.mjs";

export function useAgentTransaction({
  controller,
  actionId,
  ready,
  busy,
  review,
  identity,
  prepare,
  confirm,
  onState,
  error,
  status
}) {
  const prepared = useRef(null);
  const used = useRef(new Set());
  useImperativeHandle(controller, () => ({
    confirm: async () => {
      claimReview({ ready, busy, review, identity, used: used.current });
      await confirm();
    }
  }));
  useEffect(() => {
    if (!controller || !actionId || prepared.current === actionId) return;
    prepared.current = actionId;
    void prepare();
  }, [actionId, controller, prepare]);
  useEffect(() => {
    onState?.({ ready, busy, status, error });
  }, [onState, ready, busy, status, error]);
}
