import { sendJSON } from "../utils/response.js";
import { listTools, callTool } from "../services/mcp.service.js";

export async function getTools(req, res) {
  const tools = await listTools();
  return sendJSON(res, 200, { tools });
}

export async function postTool(req, res) {
  try {
    const { name, args } = req.body || {};
    if (!name || typeof name !== "string") {
      return sendJSON(res, 422, { error: "'name' is required" });
    }
    const result = await callTool(name, args || {});
    return sendJSON(res, 200, { result });
  } catch (err) {
    console.error("Tool call failed:", err.message);
    return sendJSON(res, 500, {
      error: "Tool execution failed",
      message: err.message,
    });
  }
}
