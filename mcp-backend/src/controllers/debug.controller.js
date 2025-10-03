import { sendJSON } from "../utils/response.js";

export function getDebugStatus(req, res) {
  return sendJSON(res, 200, {
    debugMode: getIsDebugMode(),
    message: `Debug mode is ${getIsDebugMode() ? "enabled" : "disabled"}`,
  });
}

export function toggleDebug(req, res) {
  const isDebugMode = !getIsDebugMode();
  console.log(`🔧 Debug mode ${getIsDebugMode() ? "ENABLED" : "DISABLED"}`);
  return sendJSON(res, 200, {
    debugMode: getIsDebugMode(),
    message: `Debug mode ${getIsDebugMode() ? "enabled" : "disabled"}`,
  });
}

export function getIsDebugMode() {
  return isDebugMode || false;
}
