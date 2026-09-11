import { handleWalletChat } from "../../lib/chat-api";

export default async function handler(req, res) {
  const runtimeOidc = req.headers?.["x-vercel-oidc-token"];

  if (runtimeOidc && !process.env.VERCEL_OIDC_TOKEN) {
    process.env.VERCEL_OIDC_TOKEN = String(runtimeOidc);
  }

  return handleWalletChat(req, res);
}

export const config = {
  api: { bodyParser: { sizeLimit: "32kb" } }
};
