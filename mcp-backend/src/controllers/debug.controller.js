import { sendJSON } from "../utils/response.js";

let isDebugMode = (process.env.DEBUG_MODE || "false").toLowerCase() === "true";

export function getDebugStatus(req, res) {
  return sendJSON(res, 200, {
    debugMode: isDebugMode,
    message: `Debug mode is ${isDebugMode ? "enabled" : "disabled"}`,
  });
}

export function toggleDebug(req, res) {
  isDebugMode = !isDebugMode;
  console.log(`🔧 Debug mode ${isDebugMode ? "ENABLED" : "DISABLED"}`);
  return sendJSON(res, 200, {
    debugMode: isDebugMode,
    message: `Debug mode ${isDebugMode ? "enabled" : "disabled"}`,
  });
}

export function getIsDebugMode() {
  return isDebugMode;
}
