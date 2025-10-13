import { sendJSON } from "../utils/response.js";

let debugMode = false;

export function getDebugStatus(req, res) {
  return sendJSON(res, 200, {
    debugMode: getIsDebugMode(),
    message: `Debug mode is ${getIsDebugMode() ? "enabled" : "disabled"}`,
  });
}

export function toggleDebug(req, res) {
  debugMode = !debugMode;
  console.log(`🔧 Debug mode ${debugMode ? "ENABLED" : "DISABLED"}`);
  return sendJSON(res, 200, {
    debugMode: debugMode,
    message: `Debug mode ${debugMode ? "enabled" : "disabled"}`,
  });
}

export function getIsDebugMode() {
  return !!debugMode;
}
