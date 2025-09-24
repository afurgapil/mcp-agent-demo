import "dotenv/config";
import { createServer } from "http";
import { URL } from "url";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const {
  MCP_TOOLBOX_URL,
  PORT = 3001,
  TOOL_SELECTOR_LLM_URL,
  INTERMEDIATE_LLM_URL,
  CUSTOM_LLM_URL,
  DEBUG_MODE = "true",
} = process.env;

if (!MCP_TOOLBOX_URL) {
  console.error("MCP_TOOLBOX_URL is required in .env");
  process.exit(1);
}

const toolSelectorUrl =
  TOOL_SELECTOR_LLM_URL || INTERMEDIATE_LLM_URL || CUSTOM_LLM_URL;

if (!toolSelectorUrl) {
  console.error(
    "Tool selector model URL missing. Set TOOL_SELECTOR_LLM_URL, INTERMEDIATE_LLM_URL or CUSTOM_LLM_URL"
  );
  process.exit(1);
}

let isDebugMode = DEBUG_MODE.toLowerCase() === "true";

const MCP_BASE = MCP_TOOLBOX_URL.trim().replace(/\/$/, "");
const CONFIG_FILE = join(__dirname, "config.json");

const DEFAULT_CONFIG = {
  system_prompt: `You are an AI assistant that selects the single best tool to handle a user's request.

Process:
1. Read the user prompt carefully and identify the core intent.
2. Review the available tools and their descriptions.
3. Choose the tool that best addresses the intent. If none apply, respond with null.
4. Explain the decision briefly.

Output format (JSON only):
{
  "tool": string | null,
  "reason": string,
  "confidence": number (0-1)
}`,
};

function getConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const fileContent = readFileSync(CONFIG_FILE, "utf8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(fileContent) };
    }
  } catch (err) {
    console.error("Error reading config file:", err.message);
  }
  return DEFAULT_CONFIG;
}

function saveConfig(newConfig) {
  try {
    const current = getConfig();
    const updated = { ...current, ...newConfig };
    writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), "utf8");
    return updated;
  } catch (err) {
    console.error("Error saving config file:", err.message);
    throw new Error("Configuration kaydetme hatası");
  }
}

function sendJSON(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    ...headers,
  });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve(null);
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

let mcpClientPromise = null;
async function getMcpClient() {
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
            version: "0.2.0",
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

async function listTools() {
  const client = await getMcpClient();
  const result = await client.listTools();
  return result?.tools ?? result ?? [];
}

function truncateText(value, limit = 180) {
  if (!value) return "";
  const text = String(value).trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function summarizeArguments(schema, limit = 6) {
  if (!schema || typeof schema !== "object") return [];
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return [];
  const required = Array.isArray(schema.required)
    ? new Set(schema.required)
    : new Set();

  return Object.entries(properties)
    .slice(0, limit)
    .map(([key, value]) => {
      const v = value && typeof value === "object" ? value : {};
      let type = Array.isArray(v.type)
        ? v.type.join("|")
        : v.type || (Array.isArray(v.enum) ? "enum" : v.format || "any");
      if (!type && typeof v.enum !== "undefined") type = "enum";

      return {
        name: key,
        type,
        required: required.has(key),
        description: truncateText(v.description || v.title || "", 120),
      };
    });
}

function compactTool(tool) {
  const schema = tool.input_schema || tool.inputSchema || null;
  const args = summarizeArguments(schema);
  return {
    name: tool.name,
    description: truncateText(tool.description, 220),
    arguments: args,
    hasAdditionalArguments:
      !!schema &&
      schema.properties &&
      Object.keys(schema.properties || {}).length > args.length,
  };
}

async function callTool(toolName, params) {
  const client = await getMcpClient();
  const result = await client.callTool({
    name: toolName,
    arguments: normalizeArgs(toolName, params || {}),
  });
  return result;
}

function normalizeArgs(toolName, args) {
  const normalized = { ...(args || {}) };
  for (const key of Object.keys(normalized)) {
    if (typeof normalized[key] === "string") {
      normalized[key] = normalized[key].trim();
    }
  }
  return normalized;
}

function formatToolListForPrompt(tools) {
  return tools
    .map((tool) => {
      const argsText = tool.arguments?.length
        ? tool.arguments
            .map((arg) => {
              const suffix = arg.required ? " (required)" : "";
              const desc = arg.description ? ` - ${arg.description}` : "";
              return `  - ${arg.name}: ${arg.type}${suffix}${desc}`;
            })
            .join("\n")
        : "  - (no arguments)";

      const extraArgNote = tool.hasAdditionalArguments
        ? "\n  - … additional arguments omitted"
        : "";

      return `Tool: ${tool.name}\nDescription: ${tool.description || "(none)"}\nArguments:\n${argsText}${extraArgNote}`;
    })
    .join("\n\n");
}

function buildToolSelectorPrompt(systemPrompt, userPrompt, tools) {
  const toolSummary = formatToolListForPrompt(tools);
  return `${systemPrompt.trim()}

Available tools:
${toolSummary}

User prompt:
${userPrompt.trim()}`;
}

function tryParseSelection(raw) {
  if (!raw) return null;

  if (typeof raw === "object") {
    return raw;
  }

  const text = typeof raw === "string" ? raw : String(raw);

  try {
    return JSON.parse(text);
  } catch (err) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (innerErr) {
      console.warn("Failed to parse selection JSON:", innerErr.message);
      return null;
    }
  }
}

function buildToolSelectorCandidates(baseUrl) {
  if (!baseUrl) return [];
  const trimmed = baseUrl.trim();
  if (!trimmed) return [];

  const candidates = new Set([trimmed]);

  try {
    const parsed = new URL(trimmed);
    const path = (parsed.pathname || "/").replace(/\/+$/, "");
    const hasMeaningfulPath = path && path !== "" && path !== "/";
    const includesApiGenerate = path.toLowerCase().includes("/api/generate");

    if (!hasMeaningfulPath || !includesApiGenerate) {
      const withoutTrailingSlash = trimmed.replace(/\/$/, "");
      candidates.add(`${withoutTrailingSlash}/api/generate`);
    }
  } catch (err) {
    const withoutTrailingSlash = trimmed.replace(/\/$/, "");
    candidates.add(`${withoutTrailingSlash}/api/generate`);
  }

  return Array.from(candidates);
}

async function selectToolForPrompt(userPrompt, { maxTokens = 512 } = {}) {
  const tools = await listTools();
  if (!tools.length) {
    return {
      selection: { tool: null, reason: "No tools available", confidence: 0 },
      tools: [],
      raw: null,
    };
  }

  const simplifiedTools = tools.map(compactTool);
  const config = getConfig();
  const prompt = buildToolSelectorPrompt(
    config.system_prompt,
    userPrompt,
    simplifiedTools
  );

  const payload = {
    message: prompt,
    max_tokens: maxTokens,
    temperature: 0.7,
    top_p: 0.95,
    do_sample: true,
  };

  const requestStartedAt = Date.now();
  const candidates = buildToolSelectorCandidates(toolSelectorUrl);
  if (!candidates.length) {
    throw new Error("Tool selector URL is not configured");
  }

  let lastError;

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];

    try {
      const res = await fetch(candidate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const durationMs = Date.now() - requestStartedAt;
      const responseText = await res.text();
      let data;
      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch {
          data = null;
        }
      }

      if (!res.ok) {
        const errorMessage = data?.error || data?.detail || res.statusText;
        const error = new Error(
          `Tool selector model error ${res.status} (${candidate}): ${errorMessage}`
        );

        if (res.status === 404 && index < candidates.length - 1) {
          lastError = error;
          continue;
        }

        throw error;
      }

      const raw = data?.response ?? data?.text ?? data?.result ?? responseText;
      const parsed = tryParseSelection(raw);

      if (!parsed || typeof parsed !== "object") {
        return {
          selection: {
            tool: null,
            reason: "Model response could not be parsed",
            confidence: 0,
          },
          tools: simplifiedTools,
          raw,
          rawResponseText: responseText,
          durationMs,
          requestPayload: payload,
          endpointUsed: candidate,
        };
      }

      const selection = {
        tool: parsed.tool ?? null,
        reason: parsed.reason || "",
        confidence:
          typeof parsed.confidence === "number"
            ? Math.min(Math.max(parsed.confidence, 0), 1)
            : null,
      };

      if (
        selection.tool &&
        !simplifiedTools.find((t) => t.name === selection.tool)
      ) {
        selection.tool = null;
        selection.reason = selection.reason || "Selected tool not in tool list";
        selection.confidence = 0;
      }

      return {
        selection,
        tools: simplifiedTools,
        raw,
        rawResponseText: responseText,
        durationMs,
        requestPayload: payload,
        endpointUsed: candidate,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw (
    lastError || new Error("Tool selector model call failed with no response")
  );
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method || "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    return res.end();
  }

  try {
    if (method === "GET" && url.pathname === "/health") {
      return sendJSON(res, 200, { ok: true });
    }

    if (method === "POST" && url.pathname === "/debug/toggle") {
      isDebugMode = !isDebugMode;
      console.log(`🔧 Debug mode ${isDebugMode ? "ENABLED" : "DISABLED"}`);
      return sendJSON(res, 200, {
        debugMode: isDebugMode,
        message: `Debug mode ${isDebugMode ? "enabled" : "disabled"}`,
      });
    }

    if (method === "GET" && url.pathname === "/debug/status") {
      return sendJSON(res, 200, {
        debugMode: isDebugMode,
        message: `Debug mode is ${isDebugMode ? "enabled" : "disabled"}`,
      });
    }

    if (method === "GET" && url.pathname === "/tools") {
      const tools = await listTools();
      return sendJSON(res, 200, { tools });
    }

    if (method === "POST" && url.pathname === "/tool") {
      try {
        const body = (await parseBody(req)) || {};
        const { name, args } = body;
        if (!name || typeof name !== "string") {
          return sendJSON(res, 422, {
            error: "'name' is required",
          });
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

    if (method === "POST" && url.pathname === "/api/generate") {
      const body = (await parseBody(req)) || {};
      const { prompt, max_tokens: maxTokens = 512 } = body;

      if (!prompt || typeof prompt !== "string") {
        return sendJSON(res, 422, {
          detail: [
            {
              loc: ["body", "prompt"],
              msg: "field required",
              type: "value_error.missing",
            },
          ],
        });
      }

      try {
        const result = await selectToolForPrompt(prompt, { maxTokens });
        const responseBody = {
          prompt,
          tool: result.selection.tool,
          reason: result.selection.reason,
          confidence: result.selection.confidence,
        };

        if (isDebugMode) {
          const timestamp = new Date().toISOString();
          responseBody.debug = {
            mode: "enabled",
            totalDuration: result.durationMs,
            toolSelectorUrl: result.endpointUsed || toolSelectorUrl,
            rawModelResponse: result.raw,
            rawResponseText: result.rawResponseText,
            toolsConsidered: result.tools,
            request: {
              endpoint: "/api/generate",
              prompt,
              timestamp,
            },
            aiCalls: [
              {
                modelName: "Tool Selector Model",
                input: result.requestPayload,
                output: result.raw,
                duration: result.durationMs,
                timestamp,
                metadata: {
                  success: true,
                  status: 200,
                  selectedTool: result.selection.tool,
                  confidence: result.selection.confidence,
                  endpoint: result.endpointUsed || toolSelectorUrl,
                },
              },
            ],
            stages: [
              {
                stage: "TOOLS_FETCHED",
                timestamp,
                data: { count: result.tools.length },
              },
              {
                stage: "SELECTION_PARSED",
                timestamp,
                data: {
                  tool: result.selection.tool,
                  confidence: result.selection.confidence,
                },
              },
            ],
          };
        }

        return sendJSON(res, 200, responseBody);
      } catch (err) {
        console.error("Tool selection failed:", err.message);
        return sendJSON(res, 500, {
          error: "Tool selection failed",
          message: err.message,
        });
      }
    }

    if (method === "GET" && url.pathname === "/api/config") {
      const config = getConfig();
      return sendJSON(res, 200, config);
    }

    if (method === "PUT" && url.pathname === "/api/config") {
      try {
        const body = (await parseBody(req)) || {};
        const updated = saveConfig(body);
        return sendJSON(res, 200, updated);
      } catch (err) {
        return sendJSON(res, 500, {
          error: "Configuration update failed",
          message: err.message,
        });
      }
    }

    return sendJSON(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    return sendJSON(res, 500, { error: err.message || "Internal error" });
  }
});

server.listen(Number(PORT), () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`🔧 Debug mode: ${isDebugMode ? "🟢 ENABLED" : "🔴 DISABLED"}`);
});
