import { URL } from "url";
import { env } from "../utils/env.js";

const MCP_BASE_RAW = (env.MCP_TOOLBOX_URL || "").trim();
const MCP_SSE_PATH = (env.MCP_SSE_PATH || "").trim();

function splitBaseAndPath(raw) {
  try {
    if (!raw) return { origin: "", path: "" };
    const u = new URL(raw);
    return { origin: `${u.protocol}//${u.host}`, path: u.pathname || "" };
  } catch {
    return { origin: "", path: "" };
  }
}

const { origin: MCP_ORIGIN, path: MCP_PATH_IN_BASE } =
  splitBaseAndPath(MCP_BASE_RAW);
const MCP_BASE = MCP_ORIGIN.replace(/\/$/, "");

function buildSseCandidates() {
  const explicitFromEnv =
    MCP_SSE_PATH && MCP_SSE_PATH.startsWith("/") ? MCP_SSE_PATH : null;
  const explicitFromBase =
    MCP_PATH_IN_BASE && MCP_PATH_IN_BASE !== "/" ? MCP_PATH_IN_BASE : null;
  const candidates = [
    explicitFromBase,
    explicitFromEnv,
    "/mcp/sse",
    "/sse",
    "/mcp",
    "/events",
  ].filter(Boolean);
  return candidates;
}

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
      try {
        const masked = MCP_BASE.replace(
          /(https?:\/\/[^:]+:)([^@]+)(@)/,
          "$1***$3"
        );
        console.log("[MCP] Base:", masked || "<empty>");
        console.log("[MCP] Base Path:", MCP_PATH_IN_BASE || "<none>");
        console.log("[MCP] SSE Path:", MCP_SSE_PATH || "<unspecified>");
      } catch {}
      const candidates = buildSseCandidates();
      let lastErr;
      const attempts = Number(process.env.MCP_CONNECT_RETRIES || 12);
      const delayMs = Number(process.env.MCP_CONNECT_DELAY_MS || 2500);
      for (let i = 0; i < attempts; i++) {
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
        await new Promise((r) => setTimeout(r, delayMs));
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
