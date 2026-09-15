import { handleWalletChat } from "../../lib/chat-api";

function clarifyFollowUpCommand(req) {
  if (req.method !== "POST" || !req.body || typeof req.body.question !== "string") return;

  const original = req.body.question.trim();
  const normalized = original.toLowerCase();
  const isRepeatIntent =
    /\b(repeat|retry|redo|re-do|again|same transaction|same transfer|same swap|same bridge)\b/.test(
      normalized
    );

  if (!isRepeatIntent) return;

  req.body = {
    ...req.body,
    question: `${original}\n\nLumexa action instruction: This is a follow-up command, not a request to explain the previous transaction again. Resolve “same”, “again”, “repeat”, “retry”, or “redo” from the recent conversation and wallet activity supplied in context. If the previous action has enough parameters, call the matching prepare_send, prepare_swap, or prepare_bridge tool now. If one required parameter cannot be recovered safely, ask only for that missing parameter. Do not repeat the previous explanatory answer.`
  };
}

export default async function handler(req, res) {
  const runtimeOidc = req.headers?.["x-vercel-oidc-token"];

  if (runtimeOidc && !process.env.VERCEL_OIDC_TOKEN) {
    process.env.VERCEL_OIDC_TOKEN = String(runtimeOidc);
  }

  clarifyFollowUpCommand(req);
  return handleWalletChat(req, res);
}

export const config = {
  api: { bodyParser: { sizeLimit: "32kb" } }
};
