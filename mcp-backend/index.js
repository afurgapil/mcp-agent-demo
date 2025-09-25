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
  DEEPSEEK_API_KEY,
  DEEPSEEK_API_BASE = "https://api.deepseek.com",
  DEEPSEEK_MODEL = "deepseek-chat",
  PORT = 3001,
  DEBUG_MODE = "false",
} = process.env;

if (!MCP_TOOLBOX_URL) {
  console.error("MCP_TOOLBOX_URL is required in .env");
  process.exit(1);
}

if (!DEEPSEEK_API_KEY) {
  console.error("DEEPSEEK_API_KEY is required in .env");
  process.exit(1);
}

let isDebugMode = DEBUG_MODE.toLowerCase() === "true";

const MCP_BASE = MCP_TOOLBOX_URL.trim().replace(/\/$/, "");
const CONFIG_FILE = join(__dirname, "config.json");
const SCHEMA_SUMMARY_FILE = join(__dirname, "schema.summary.json");
const USAGE_CSV_FILE = join(__dirname, "deepseek_usage.csv");

const DEFAULT_CONFIG = {
  system_prompt: `You are an expert SQL engineer. Receive natural language questions together with the database schema and reply with a SQL statement that can be executed directly against the database. Output only the SQL statement without explanations or markdown fences. Use the schema exactly as provided.`,
  schema: "",
};

const AUTO_SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedAutoSchema = "";
let cachedAutoSchemaTimestamp = 0;

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

function tryLoadSchemaSummary() {
  try {
    if (!existsSync(SCHEMA_SUMMARY_FILE)) return null;
    const text = readFileSync(SCHEMA_SUMMARY_FILE, "utf8").trim();
    if (!text) return null;
    return text;
  } catch {
    return null;
  }
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function updateUsageCsv({
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = 0,
  schemaSource = "",
}) {
  try {
    const header =
      "timestamp,prompt_tokens,completion_tokens,total_tokens,schema_source\n";
    let lines = [];
    if (existsSync(USAGE_CSV_FILE)) {
      const raw = readFileSync(USAGE_CSV_FILE, "utf8");
      lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    }

    // Preserve header if present; drop any existing TOTAL row(s)
    const body = [];
    let hasHeader = false;
    for (const line of lines) {
      if (!hasHeader && line.toLowerCase().startsWith("timestamp,")) {
        hasHeader = true;
        continue;
      }
      if (line.startsWith("TOTAL,")) continue;
      body.push(line);
    }

    // Compute previous total
    let previousTotal = 0;
    for (const row of body) {
      const parts = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (inQuotes) {
          if (ch === '"') {
            if (row[i + 1] === '"') {
              current += '"';
              i++;
            } else {
              inQuotes = false;
            }
          } else {
            current += ch;
          }
        } else {
          if (ch === ",") {
            parts.push(current);
            current = "";
          } else if (ch === '"') {
            inQuotes = true;
          } else {
            current += ch;
          }
        }
      }
      parts.push(current);
      const totalStr = parts[3];
      const n = Number(totalStr);
      if (!Number.isNaN(n)) previousTotal += n;
    }

    const now = new Date().toISOString();
    const newRow = [
      csvEscape(now),
      csvEscape(promptTokens),
      csvEscape(completionTokens),
      csvEscape(totalTokens),
      csvEscape(schemaSource),
    ].join(",");

    const newBody = [...body, newRow];
    const grandTotal = previousTotal + (Number(totalTokens) || 0);
    const totalRow = `TOTAL,,,${csvEscape(grandTotal)},`;

    const content =
      (hasHeader ? "" : header) + newBody.join("\n") + "\n" + totalRow + "\n";
    writeFileSync(USAGE_CSV_FILE, content, "utf8");
  } catch (err) {
    console.warn("Failed to update usage CSV:", err.message);
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

async function listTools() {
  const client = await getMcpClient();
  const result = await client.listTools();
  return result?.tools ?? result ?? [];
}

async function callTool(toolName, params) {
  const client = await getMcpClient();
  const normalized = normalizeArgs(params || {});
  const result = await client.callTool({
    name: toolName,
    arguments: normalized,
  });
  return result;
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

function rowsToTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((col) => set.add(col));
      return set;
    }, new Set())
  );
  if (!columns.length) return "";

  const lines = [];
  lines.push(columns.join(" | "));
  lines.push(columns.map(() => "---").join(" | "));
  for (const row of rows) {
    const line = columns
      .map((col) => {
        const value = row && col in row ? row[col] : "";
        return value === null || value === undefined ? "" : String(value);
      })
      .join(" | ");
    lines.push(line);
  }
  return lines.join("\n");
}

function extractTextFromToolResult(result) {
  if (!result) return "";

  if (typeof result === "string") return result;

  if (Array.isArray(result)) {
    return result.map(extractTextFromToolResult).filter(Boolean).join("\n");
  }

  const pieces = [];
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item && typeof item.text === "string") {
        pieces.push(item.text);
      }
    }
  }

  if (typeof result.text === "string") {
    pieces.push(result.text);
  }

  if (Array.isArray(result.rows) && result.rows.length) {
    pieces.push(rowsToTable(result.rows));
  }

  if (!pieces.length) {
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return "";
    }
  }

  return pieces.join("\n").trim();
}

function parseTablesFromResult(result) {
  const names = new Set();
  if (Array.isArray(result?.rows)) {
    for (const row of result.rows) {
      for (const value of Object.values(row || {})) {
        if (typeof value === "string" && value.trim()) {
          names.add(value.trim());
        }
      }
    }
  }

  const text = extractTextFromToolResult(result);
  if (text) {
    for (const raw of text.split(/[^A-Za-z0-9_`]+/)) {
      const cleaned = raw.replace(/`/g, "").trim();
      if (cleaned && /^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)) {
        names.add(cleaned);
      }
    }
  }

  return Array.from(names);
}

async function fetchCreateStatementForTable(table, toolNames) {
  // Prefer SHOW CREATE TABLE if available
  if (toolNames.has("mysql_show_create_table")) {
    try {
      const createRes = await callTool("mysql_show_create_table", { table });
      const createText = extractTextFromToolResult(createRes);
      if (createText) {
        return createText.trim();
      }
    } catch (err) {
      console.warn(
        `mysql_show_create_table failed for ${table}: ${err.message}`
      );
    }
  }

  if (toolNames.has("mysql_describe_table")) {
    try {
      const describeRes = await callTool("mysql_describe_table", { table });
      const describeText =
        rowsToTable(describeRes?.rows) ||
        extractTextFromToolResult(describeRes);
      if (describeText) {
        return describeText.trim();
      }
    } catch (err) {
      console.warn(`mysql_describe_table failed for ${table}: ${err.message}`);
    }
  }

  return "(schema unavailable)";
}

async function fetchSchemaFromMcp({ maxTables = 25 } = {}) {
  try {
    const tools = await listTools();
    const toolNames = new Set(tools.map((tool) => tool.name));

    if (!toolNames.has("mysql_show_tables")) {
      console.warn(
        "mysql_show_tables tool not available; cannot auto-fetch schema"
      );
      return "";
    }

    const tablesResult = await callTool("mysql_show_tables", {});
    const tables = parseTablesFromResult(tablesResult);
    if (!tables.length) {
      console.warn("mysql_show_tables did not return any tables");
      return "";
    }

    const limitedTables = tables.slice(0, maxTables);
    const schemaParts = [];

    for (const table of limitedTables) {
      const definition = await fetchCreateStatementForTable(table, toolNames);
      schemaParts.push(`-- Table: ${table}\n${definition}`);
    }

    return schemaParts.join("\n\n");
  } catch (err) {
    console.warn(`Failed to fetch schema from MCP: ${err.message}`);
    return "";
  }
}

async function getAutoSchemaFromCache() {
  const now = Date.now();
  if (
    cachedAutoSchema &&
    now - cachedAutoSchemaTimestamp < AUTO_SCHEMA_CACHE_TTL_MS
  ) {
    return { schema: cachedAutoSchema, source: "cache" };
  }

  const fetched = await fetchSchemaFromMcp();
  if (fetched && fetched.trim()) {
    cachedAutoSchema = fetched.trim();
    cachedAutoSchemaTimestamp = now;
    return { schema: cachedAutoSchema, source: "fetched" };
  }

  return { schema: "", source: "none" };
}

function buildUserMessage(userPrompt, schema) {
  if (schema && schema.trim()) {
    return `Database schema:\n${schema.trim()}\n\nUser request:\n${userPrompt.trim()}`;
  }
  return userPrompt.trim();
}

function extractSqlFromText(text) {
  if (!text) return "";
  const fenceMatch = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const raw = fenceMatch ? fenceMatch[1] : text;
  const withoutLabel = raw.replace(/^SQL\s*[:\-]\s*/i, "");
  return withoutLabel.trim();
}

async function callDeepseekForSql({ userPrompt, schema, systemPrompt }) {
  const messages = [
    { role: "system", content: systemPrompt.trim() },
    { role: "user", content: buildUserMessage(userPrompt, schema) },
  ];

  const body = {
    model: DEEPSEEK_MODEL,
    messages,
    temperature: 0,
    stream: false,
  };

  const endpoint = new URL(
    "/v1/chat/completions",
    DEEPSEEK_API_BASE
  ).toString();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let data = null;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      throw new Error("Deepseek response parse error");
    }
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.detail ||
      response.statusText;
    throw new Error(`Deepseek API error ${response.status}: ${message}`);
  }

  const choice = data?.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    throw new Error("Deepseek returned empty content");
  }

  const sql = extractSqlFromText(content);
  if (!sql) {
    throw new Error("Deepseek response did not include SQL");
  }

  const usage = data?.usage || null;
  if (usage) {
    try {
      console.log(
        `Deepseek tokens — prompt: ${usage.prompt_tokens ?? "?"}, completion: ${
          usage.completion_tokens ?? "?"
        }, total: ${usage.total_tokens ?? "?"}`
      );
    } catch {}
  }

  return {
    sql,
    rawContent: content,
    response: data,
    request: body,
    usage,
  };
}

async function executeSqlThroughMcp(sql) {
  const startedAt = Date.now();
  const result = await callTool("mysql_execute_sql", { sql });
  const durationMs = Date.now() - startedAt;
  return { result, durationMs };
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

    if (method === "POST" && url.pathname === "/api/reload-schema") {
      const fileSchema = tryLoadSchemaSummary();
      if (!fileSchema) {
        return sendJSON(res, 404, {
          error: "schema.summary.json not found or empty",
        });
      }
      const updated = saveConfig({ schema: fileSchema });
      cachedAutoSchema = fileSchema;
      cachedAutoSchemaTimestamp = Date.now();
      return sendJSON(res, 200, {
        message: "Schema reloaded from file",
        length: fileSchema.length,
        config: { schemaLength: (updated.schema || "").length },
      });
    }

    if (method === "POST" && url.pathname === "/api/generate") {
      const body = (await parseBody(req)) || {};
      const { prompt, schema: customSchema } = body;

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

      const config = getConfig();

      let schemaToUse = "";
      let schemaSource = "none";

      if (typeof customSchema === "string" && customSchema.trim()) {
        schemaToUse = customSchema.trim();
        schemaSource = "custom";
      } else if (typeof config.schema === "string" && config.schema.trim()) {
        schemaToUse = config.schema.trim();
        schemaSource = "config";
      } else {
        // Prefer local summary file if present
        const fileSchema = tryLoadSchemaSummary();
        if (fileSchema) {
          schemaToUse = fileSchema;
          schemaSource = "file";
        } else {
          const autoSchema = await getAutoSchemaFromCache();
          if (autoSchema.schema && autoSchema.schema.trim()) {
            schemaToUse = autoSchema.schema.trim();
            schemaSource = autoSchema.source || "fetched";
            if (schemaSource === "fetched") {
              try {
                saveConfig({ schema: schemaToUse });
              } catch (persistErr) {
                console.warn(
                  `Failed to persist fetched schema: ${persistErr.message}`
                );
              }
            }
          }
        }
      }

      const startTime = Date.now();
      const debugInfo = {
        schema: {
          source: schemaSource,
          length: schemaToUse.length,
        },
        deepseek: null,
        execution: null,
        totalDurationMs: 0,
      };

      try {
        const deepseekResponse = await callDeepseekForSql({
          userPrompt: prompt,
          schema: schemaToUse,
          systemPrompt: config.system_prompt,
        });

        debugInfo.deepseek = {
          request: deepseekResponse.request,
          response: deepseekResponse.response,
        };

        const { result: executionResult, durationMs } =
          await executeSqlThroughMcp(deepseekResponse.sql);

        debugInfo.execution = {
          durationMs,
          result: executionResult,
        };

        debugInfo.totalDurationMs = Date.now() - startTime;

        const responsePayload = {
          prompt,
          sql: deepseekResponse.sql,
          rawModelOutput: deepseekResponse.rawContent,
          executionResult,
          schemaSource,
          usage: deepseekResponse.usage || undefined,
        };

        if (isDebugMode) {
          responsePayload.debug = {
            mode: "enabled",
            totalDurationMs: debugInfo.totalDurationMs,
            schema: {
              source: schemaSource,
              length: schemaToUse.length,
              snippet: schemaToUse.slice(0, 2000),
            },
            deepseek: {
              request: debugInfo.deepseek.request,
              response: debugInfo.deepseek.response,
              usage: deepseekResponse.usage || null,
            },
            execution: debugInfo.execution,
          };
        }

        // Update token usage CSV
        if (deepseekResponse.usage) {
          updateUsageCsv({
            promptTokens: deepseekResponse.usage.prompt_tokens,
            completionTokens: deepseekResponse.usage.completion_tokens,
            totalTokens: deepseekResponse.usage.total_tokens,
            schemaSource,
          });
        }

        return sendJSON(res, 200, responsePayload);
      } catch (err) {
        console.error("Generation pipeline failed:", err.message);
        const duration = Date.now() - startTime;
        debugInfo.totalDurationMs = duration;

        if (isDebugMode) {
          return sendJSON(res, 500, {
            error: "Pipeline failed",
            message: err.message,
            debug: {
              mode: "enabled",
              totalDurationMs: duration,
              schema: {
                source: schemaSource,
                length: schemaToUse.length,
                snippet: schemaToUse.slice(0, 2000),
              },
              deepseek: debugInfo.deepseek,
              execution: debugInfo.execution,
            },
          });
        }

        return sendJSON(res, 500, {
          error: "Pipeline failed",
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
