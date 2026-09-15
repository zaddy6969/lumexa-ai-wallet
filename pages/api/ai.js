import { handleWalletChat } from "../../lib/chat-api";
import { resolveNaturalWalletAgent } from "../../lib/natural-wallet-agent";

export default async function handler(req, res) {
  const runtimeOidc = req.headers?.["x-vercel-oidc-token"];

  if (runtimeOidc && !process.env.VERCEL_OIDC_TOKEN) {
    process.env.VERCEL_OIDC_TOKEN = String(runtimeOidc);
  }

  // Transaction commands need deterministic parameter fidelity. Resolve them before the
  // general model so normal English such as “swap fifty dollars to euros” becomes a
  // structured action with the exact amount instead of merely opening a wallet tab.
  // This layer also provides reliable Arc/Lumexa onboarding answers when cloud inference
  // is temporarily unavailable; all other questions continue to the real AI provider.
  if (req.method === "POST" && req.body) {
    const naturalResult = resolveNaturalWalletAgent(req.body);
    if (naturalResult) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(naturalResult);
    }
  }

  return handleWalletChat(req, res);
}

export const config = {
  api: { bodyParser: { sizeLimit: "32kb" } }
};
