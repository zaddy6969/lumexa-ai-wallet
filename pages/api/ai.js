import { handleWalletChat } from "../../lib/chat-api";

export default async function handler(req, res) {
  return handleWalletChat(req, res);
}

export const config = {
  api: { bodyParser: { sizeLimit: "32kb" } },
  maxDuration: 60
};
