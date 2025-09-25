import { sendJSON } from "../utils/response.js";

export async function getHealth(req, res) {
  return sendJSON(res, 200, { ok: true });
}
