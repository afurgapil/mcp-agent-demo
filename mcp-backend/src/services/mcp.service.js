import { URL } from "url";

const MCP_BASE = (process.env.MCP_TOOLBOX_URL || "").trim().replace(/\/$/, "");

let mcpClientPromise = null;

export async function getMcpClient() {
  if (mcpClientPromise) return mcpClientPromise;
  mcpClientPromise = (async () => {
    try {
      const { SSEClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/sse.js"
      );
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );
      const candidates = [
        process.env.MCP_SSE_PATH || "/sse",
        "/mcp/sse",
        "/mcp",
        "/events",
      ];
      let lastErr;
      for (const path of candidates) {
        try {
          const sseUrl = new URL(path, MCP_BASE + "/");
          const transport = new SSEClientTransport(sseUrl);
          const client = new Client({
            name: "mcp-agent-backend",
            version: "0.3.0",
          });
          await client.connect(transport);
          return client;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error("No SSE endpoint candidates worked");
    } catch (err) {
      throw new Error(
        `MCP SSE connect failed. Check MCP_TOOLBOX_URL and MCP_SSE_PATH (default /sse). Error: ${err?.message}`
      );
    }
  })();
  return mcpClientPromise;
}

export async function listTools() {
  const client = await getMcpClient();
  const result = await client.listTools();
  return result?.tools ?? result ?? [];
}

function normalizeArgs(args) {
  const normalized = { ...(args || {}) };
  for (const key of Object.keys(normalized)) {
    if (typeof normalized[key] === "string") {
      normalized[key] = normalized[key].trim();
    }
  }
  return normalized;
}

export async function callTool(toolName, params) {
  const client = await getMcpClient();
  const normalized = normalizeArgs(params || {});
  const result = await client.callTool({
    name: toolName,
    arguments: normalized,
  });
  return result;
}
