import { sendJSON } from "../utils/response.js";
import { getConfig, saveConfig } from "../services/config.service.js";

export function getConfigHandler(req, res) {
  const config = getConfig();
  return sendJSON(res, 200, config);
}

export function putConfigHandler(req, res) {
  try {
    const updated = saveConfig(req.body || {});
    return sendJSON(res, 200, updated);
  } catch (err) {
    return sendJSON(res, 500, {
      error: "Configuration update failed",
      message: err.message,
    });
  }
}
