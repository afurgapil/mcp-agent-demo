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
  CUSTOM_LLM_URL = "http://192.168.1.113:8001/api/generate",
  INTERMEDIATE_LLM_URL = "http://192.168.1.113:8000/api/generate",
  DEBUG_MODE = "true",
} = process.env;

// Debug mode state
let isDebugMode = DEBUG_MODE.toLowerCase() === "true";

if (!MCP_TOOLBOX_URL) {
  console.error("MCP_TOOLBOX_URL is required in .env");
  process.exit(1);
}
const MCP_BASE = MCP_TOOLBOX_URL.trim().replace(/\/$/, "");

// Intermediate LLM model - processes and enhances user queries
async function callIntermediateLLM(userMessage, opts = {}) {
  // Use proper GenerateRequest format according to OpenAPI schema
  const bodyPayload = {
    message: userMessage,
    max_tokens: opts.max_tokens || 1024,
    temperature: opts.temperature || 0.7,
    top_p: opts.top_p || 0.95,
    do_sample: opts.do_sample !== undefined ? opts.do_sample : true,
  };

  console.log(
    "Calling Intermediate LLM (Thinking SQL API) with:",
    JSON.stringify(bodyPayload, null, 2)
  );

  try {
    const res = await fetch(INTERMEDIATE_LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    const data = await res.json();
    console.log("Intermediate LLM Response:", JSON.stringify(data, null, 2));

    if (!res.ok) {
      const errMsg = data?.error || data?.detail || res.statusText;
      throw new Error(`Intermediate LLM error ${res.status}: ${errMsg}`);
    }

    // According to ChatResponse schema, field should be "response"
    const response = data?.response;
    if (!response) {
      console.log("Available intermediate LLM data keys:", Object.keys(data));
      console.log("Expected 'response' field from ChatResponse schema");
      throw new Error("Empty response from intermediate LLM");
    }

    return response;
  } catch (err) {
    console.log(`Intermediate LLM call failed: ${err.message}`);
    throw err;
  }
}

// NL to SQL model - converts natural language to SQL
async function generateText(question, schema, opts = {}) {
  // Use proper SQLRequest format according to OpenAPI schema
  const bodyPayload = {
    question: question,
    schema: schema,
    max_tokens: opts.max_tokens || 300,
  };

  console.log(
    "Calling NL to SQL Model (SQLCoder API) with:",
    JSON.stringify(bodyPayload, null, 2)
  );

  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`NL to SQL attempt ${attempt}/${maxRetries}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const res = await fetch(CUSTOM_LLM_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Connection: "keep-alive",
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorText = await res.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }
        const errMsg = errorData?.error || errorData?.detail || res.statusText;
        throw new Error(`NL to SQL model HTTP ${res.status}: ${errMsg}`);
      }

      const data = await res.json();
      console.log("NL to SQL Model Response:", JSON.stringify(data, null, 2));

      // According to SQLResponse schema, field should be "sql"
      const sql = data?.sql;

      console.log("Extracted SQL text:", sql);

      if (!sql) {
        console.log("Available NL to SQL data keys:", Object.keys(data));
        console.log("Expected 'sql' field from SQLResponse schema");
        throw new Error("Empty response from NL to SQL model");
      }

      return sql;
    } catch (error) {
      lastError = error;
      console.error(`NL to SQL attempt ${attempt} failed:`, error.message);

      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt - 1) * 1000; // Exponential backoff: 1s, 2s, 4s
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  throw new Error(
    `NL to SQL model failed after ${maxRetries} attempts. Last error: ${lastError?.message}`
  );
}

// MCP client helpers
async function listTools() {
  const client = await getMcpClient();
  const result = await client.listTools();
  return result?.tools ?? result;
}

async function callTool(toolName, params) {
  const client = await getMcpClient();
  const norm = normalizeArgs(toolName, params || {});
  const result = await client.callTool({ name: toolName, arguments: norm });
  return result;
}

function normalizeArgs(toolName, args) {
  const a = { ...(args || {}) };
  // Basic trimming for string fields
  for (const k of Object.keys(a)) {
    if (typeof a[k] === "string") a[k] = a[k].trim();
  }
  return a;
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
      // Try common SSE paths if explicit not provided
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
            version: "0.1.0",
          });
          await client.connect(transport);
          return client;
        } catch (e) {
          lastErr = e;
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

// Configuration management
const CONFIG_FILE = join(__dirname, "config.json");

const DEFAULT_CONFIG = {
  system_prompt: `You are a SQL Generator. Your job is to convert natural language requests into valid SQL queries based on the provided database schema.

Your task:
1. Analyze the user's natural language request
2. Examine the provided database schema
3. Generate a valid SQL query that fulfills the request

Output requirements:
- Return ONLY the SQL query, no explanations or markdown
- Use exact table and column names from the schema
- Ensure the query is syntactically correct
- Use appropriate SQL operations (SELECT, INSERT, UPDATE, DELETE)
- Include proper WHERE clauses, JOINs, and ORDER BY as needed
- Handle date/time operations correctly
- Use appropriate aggregation functions when needed

Example:
User request: "Show me all active cameras"
Schema: devices table with device_id, name, type, status columns
Output: SELECT * FROM devices WHERE type = 'camera' AND status = 'active';

Always generate clean, executable SQL without any additional text.`,
  schema: `-- Table for all devices
CREATE TABLE devices (
    device_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type ENUM('camera', 'sensor', 'gateway', 'other') NOT NULL,
    location VARCHAR(255),
    status ENUM('active', 'inactive', 'maintenance') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Specific table for cameras (extends devices)
CREATE TABLE cameras (
    camera_id INT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    resolution VARCHAR(50), -- e.g. "1920x1080"
    fps INT,                -- frames per second
    ip_address VARCHAR(100),
    angle_of_view DECIMAL(5,2), -- degrees
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

-- Signals table (raw or processed signals from devices)
CREATE TABLE signals (
    signal_id INT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    signal_type ENUM('temperature', 'motion', 'video', 'audio', 'other') NOT NULL,
    value VARCHAR(255),  -- can store raw data or references
    unit VARCHAR(50),    -- e.g. °C, dB, JSON
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

-- Historical logs for signals
CREATE TABLE signal_logs (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    signal_id INT NOT NULL,
    value VARCHAR(255),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (signal_id) REFERENCES signals(signal_id) ON DELETE CASCADE
);

-- Users who manage devices
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    role ENUM('admin', 'operator', 'viewer') DEFAULT 'viewer',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Permissions for devices (user-device mapping)
CREATE TABLE device_permissions (
    permission_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    device_id INT NOT NULL,
    can_view BOOLEAN DEFAULT TRUE,
    can_control BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);`,
};

function getConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const configData = readFileSync(CONFIG_FILE, "utf8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(configData) };
    }
  } catch (error) {
    console.error("Error reading config file:", error.message);
  }
  return DEFAULT_CONFIG;
}

function saveConfig(newConfig) {
  try {
    const currentConfig = getConfig();
    const updatedConfig = { ...currentConfig, ...newConfig };
    writeFileSync(CONFIG_FILE, JSON.stringify(updatedConfig, null, 2), "utf8");
    return updatedConfig;
  } catch (error) {
    console.error("Error saving config file:", error.message);
    throw new Error("Configuration kaydetme hatası");
  }
}

// HTTP server helpers

// HTTP server (no external dependencies)
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
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method || "GET";

  // CORS preflight
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

    // Debug mode endpoints
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

    // CORS test endpoint
    if (method === "GET" && url.pathname === "/cors-test") {
      return sendJSON(res, 200, {
        message: "CORS is working!",
        timestamp: new Date().toISOString(),
        headers: req.headers,
      });
    }

    if (method === "GET" && url.pathname === "/tools") {
      const tools = await listTools();
      return sendJSON(res, 200, { tools });
    }

    if (method === "POST" && url.pathname === "/tool") {
      const body = (await parseBody(req)) || {};
      const { name, args } = body;
      if (!name) return sendJSON(res, 400, { error: "'name' is required" });
      const result = await callTool(name, args || {});
      return sendJSON(res, 200, { result });
    }

    // NL to SQL endpoint with debug support
    if (method === "POST" && url.pathname === "/nl") {
      const body = (await parseBody(req)) || {};
      const { query, customSchema, confirmDangerous = false } = body;
      if (!query || typeof query !== "string") {
        return sendJSON(res, 400, { error: "'query' (string) is required" });
      }

      console.log("=== Starting 2-Stage LLM Processing ===");
      console.log("Original user query:", query);

      // Track debug info
      const debugData = {
        request: {
          endpoint: "/nl",
          query: query,
          customSchema: !!customSchema,
          timestamp: new Date().toISOString(),
        },
        aiCalls: [],
        stages: [],
        totalDuration: 0,
      };

      const startTime = Date.now();

      // STAGE 1: Process user query with intermediate LLM
      let processedQuery;
      try {
        debugData.stages.push({
          stage: "STAGE_1_START",
          timestamp: new Date().toISOString(),
          data: { originalQuery: query },
        });

        console.log("\n--- Stage 1: Intermediate LLM Processing ---");
        const stage1Start = Date.now();
        processedQuery = await callIntermediateLLM(query, {
          max_tokens: 1024,
          temperature: 0.7,
        });
        const stage1Duration = Date.now() - stage1Start;

        // Use planner output as-is (no sanitizer)
        processedQuery = String(processedQuery || "");

        console.log(
          "Intermediate LLM processed query (one sentence):",
          processedQuery
        );

        debugData.aiCalls.push({
          modelName: "Intermediate LLM",
          input: { message: query, max_tokens: 1024, temperature: 0.7 },
          output: processedQuery,
          duration: stage1Duration,
          timestamp: new Date().toISOString(),
          metadata: { success: true, status: 200 },
        });

        debugData.stages.push({
          stage: "STAGE_1_SUCCESS",
          timestamp: new Date().toISOString(),
          data: { originalQuery: query, processedQuery: processedQuery },
        });
      } catch (intermediateErr) {
        console.error(
          "Intermediate LLM failed, using original query:",
          intermediateErr.message
        );
        processedQuery = query; // Fallback to original query

        debugData.aiCalls.push({
          modelName: "Intermediate LLM",
          input: { message: query, max_tokens: 300, temperature: 0.7 },
          output: null,
          duration: 0,
          timestamp: new Date().toISOString(),
          metadata: { success: false, error: intermediateErr.message },
        });

        debugData.stages.push({
          stage: "STAGE_1_FALLBACK",
          timestamp: new Date().toISOString(),
          data: {
            error: intermediateErr.message,
            fallbackQuery: processedQuery,
          },
        });
      }

      // Use custom schema or attempt to fetch from external config service
      let schema = customSchema;
      let systemPrompt = null;

      if (!customSchema) {
        try {
          // Fetch config from external LLM service
          const configRes = await fetch("http://192.168.1.113:8000/api/config");
          if (configRes.ok) {
            const configData = await configRes.json();
            schema = configData.schema;
            systemPrompt = configData.system_prompt;
          } else {
            // If external config fails, don't show anything instead of static content
            console.warn(
              "External config service unavailable, skipping processing"
            );
            return sendJSON(res, 503, {
              error: "Configuration service temporarily unavailable",
              message: "Sistem konfigürasyonu şu anda mevcut değil",
              retry: true,
            });
          }
        } catch (configErr) {
          console.warn("Failed to fetch external config:", configErr.message);
          // If external config fails, don't show anything instead of static content
          return sendJSON(res, 503, {
            error: "Configuration service error",
            message: "Sistem konfigürasyonu erişilemez durumda",
            details: configErr.message,
            retry: true,
          });
        }
      }

      // STAGE 2: Convert processed query to SQL using NL to SQL model
      let sql;
      try {
        debugData.stages.push({
          stage: "STAGE_2_START",
          timestamp: new Date().toISOString(),
          data: { processedQuery: processedQuery, schemaLength: schema.length },
        });

        console.log("\n--- Stage 2: NL to SQL Model ---");
        const stage2Start = Date.now();

        // Send planner output directly to SQL generator
        const rawResponse = await generateText(processedQuery, schema, {
          max_tokens: 1000,
        });

        const stage2Duration = Date.now() - stage2Start;
        sql = (rawResponse || "").trim();

        debugData.aiCalls.push({
          modelName: "NL to SQL Model",
          input: {
            question: processedQuery,
            schema: schema.substring(0, 100) + "...",
            max_tokens: 1000,
          },
          output: sql,
          duration: stage2Duration,
          timestamp: new Date().toISOString(),
          metadata: { success: true, status: 200 },
        });

        debugData.stages.push({
          stage: "STAGE_2_SUCCESS",
          timestamp: new Date().toISOString(),
          data: { sql: sql },
        });
      } catch (sqlErr) {
        console.error("NL to SQL model failed:", sqlErr.message);

        debugData.aiCalls.push({
          modelName: "NL to SQL Model",
          input: {
            question: processedQuery,
            schema: schema ? schema.substring(0, 100) + "..." : "No schema",
            max_tokens: 300,
          },
          output: null,
          duration: 0,
          timestamp: new Date().toISOString(),
          metadata: { success: false, error: sqlErr.message },
        });

        return sendJSON(res, 500, {
          error: "NL to SQL model failed",
          details: sqlErr.message,
          originalQuery: query,
          processedQuery: processedQuery,
        });
      }

      // Execute SQL: support multiple statements sequentially
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const dangerousRegex = /\b(DROP|TRUNCATE)\b/i;
      const dangerousStatements = statements
        .map((stmt, index) => ({ index, stmt }))
        .filter(({ stmt }) => dangerousRegex.test(stmt));

      if (dangerousStatements.length && !confirmDangerous) {
        debugData.stages.push({
          stage: "SQL_DANGEROUS_DETECTED",
          timestamp: new Date().toISOString(),
          data: {
            count: dangerousStatements.length,
            statements: dangerousStatements,
          },
        });
        return sendJSON(res, 409, {
          requiresConfirmation: true,
          message:
            "Bu işlem DROP/TRUNCATE içeriyor. Devam etmek istiyor musunuz?",
          dangerous: dangerousStatements,
          originalQuery: query,
          processedQuery,
          sql,
        });
      }

      const maxStatements = 5;
      const executionResults = [];

      for (let i = 0; i < Math.min(statements.length, maxStatements); i++) {
        const stmt = statements[i];
        const start = Date.now();
        let stepResult = null;

        try {
          const result = await callTool("mysql_execute_sql", { sql: stmt });
          stepResult = {
            index: i,
            sql: stmt,
            durationMs: Date.now() - start,
            result,
          };
          executionResults.push(stepResult);
          debugData.stages.push({
            stage: "SQL_EXECUTION_SUCCESS",
            timestamp: new Date().toISOString(),
            data: stepResult,
          });
        } catch (execErr) {
          stepResult = {
            index: i,
            sql: stmt,
            durationMs: Date.now() - start,
            error: execErr.message,
          };
          executionResults.push(stepResult);
          debugData.stages.push({
            stage: "SQL_EXECUTION_ERROR",
            timestamp: new Date().toISOString(),
            data: stepResult,
          });
        }
      }

      // Backward compatibility: expose last successful result as executionResult
      const lastOk = [...executionResults].reverse().find((r) => !r.error);
      const executionResult = lastOk
        ? lastOk.result
        : executionResults[executionResults.length - 1] || null;

      debugData.totalDuration = Date.now() - startTime;
      debugData.stages.push({
        stage: "FINAL_RESPONSE",
        timestamp: new Date().toISOString(),
        data: {
          originalQuery: query,
          processedQuery: processedQuery,
          sql: sql,
        },
      });

      console.log("\n=== Final Response ===");
      console.log("Original query:", query);
      console.log("Processed query:", processedQuery);
      console.log("Generated SQL:", sql);

      const response = {
        originalQuery: query,
        processedQuery: processedQuery,
        sql: sql,
        statements,
        executionResults,
        executionResult: executionResult,
        stages: {
          intermediate: "completed",
          nlToSql: "completed",
          sqlExecution: executionResults.length ? "completed" : "skipped",
        },
      };

      // Add debug information if debug mode is enabled
      if (isDebugMode) {
        response.debug = {
          mode: "enabled",
          ...debugData,
        };
      }

      return sendJSON(res, 200, response);
    }

    // API Generate endpoint for SQL generation
    if (method === "POST" && url.pathname === "/api/generate") {
      const body = (await parseBody(req)) || {};
      const { message, max_tokens = 9999 } = body;

      if (!message || typeof message !== "string") {
        return sendJSON(res, 422, {
          detail: [
            {
              loc: ["body", "message"],
              msg: "field required",
              type: "value_error.missing",
            },
          ],
        });
      }

      try {
        const config = getConfig();

        console.log("=== API Generate Processing ===");
        console.log("Original message:", message);

        // STAGE 1: Process user message with intermediate LLM
        let processedMessage;
        try {
          console.log("\n--- Stage 1: Intermediate LLM Processing ---");
          processedMessage = await callIntermediateLLM(message, {
            max_tokens: Math.min(max_tokens, 1024),
            temperature: 0.7,
          });
          console.log("Intermediate LLM processed message:", processedMessage);
        } catch (intermediateErr) {
          console.error(
            "Intermediate LLM failed, using original message:",
            intermediateErr.message
          );
          processedMessage = message; // Fallback to original message
        }

        // STAGE 2: Convert to SQL using NL to SQL model
        let sql;
        try {
          console.log("\n--- Stage 2: NL to SQL Model ---");

          // Use configured schema
          let schema = config.schema;
          if (schema.length > 4000) {
            schema =
              schema.substring(0, 4000) +
              "\n-- Schema truncated for model stability";
            console.log("Schema truncated to prevent model overload");
          }

          // Normalize planner output to one sentence (max 30 words)
          const compact = String(processedMessage || "")
            .replace(/\s+/g, " ")
            .trim();
          let oneSentence = compact.split(/[.!?]/)[0] || compact;
          const words = oneSentence.split(" ").filter(Boolean);
          if (words.length > 30) oneSentence = words.slice(0, 30).join(" ");

          // Send planner output directly to SQL generator
          const rawResponse = await generateText(oneSentence, schema, {
            max_tokens: Math.min(max_tokens, 1000),
          });

          // Clean up SQL response (same logic as existing /nl endpoint)
          sql = (rawResponse || "").trim();

          // Remove everything after first semicolon if it's not SQL
          const semicolonIndex = sql.indexOf(";");
          if (semicolonIndex !== -1) {
            const afterSemicolon = sql.substring(semicolonIndex + 1).trim();
            if (
              afterSemicolon &&
              !afterSemicolon.match(
                /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|SELECT|COMMIT|ROLLBACK)/i
              )
            ) {
              sql = sql.substring(0, semicolonIndex + 1);
            }
          }

          // Remove markdown and instruction text
          sql = sql.replace(/^```\w*\n?/gm, "").replace(/\n?```$/gm, "");
          sql = sql.replace(/^(Return ONLY the SQL statement[\s\S]*?\n)/i, "");
          sql = sql.replace(/^\s*-\s.*$/gm, "");

          // Find first SQL keyword
          const firstSql = sql.match(
            /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|SELECT)\b/i
          );
          if (firstSql) sql = sql.slice(firstSql.index);

          // Final cleanup
          sql = sql.replace(/^(SQL|MySQL|Query):\s*/i, "");
          sql = sql.replace(/\s+###.*$/s, "");
          sql = sql.replace(/\s+I want to.*$/s, "");
          sql = sql.trim();

          // Remove CREATE TABLE statements
          sql = sql.replace(/CREATE\s+TABLE[^;]*;?\s*/gi, "");

          // Keep only the first complete statement
          const statements = sql
            .split(";")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (statements.length > 0) {
            sql = statements[0];
          }

          // Convert PostgreSQL syntax to MySQL
          sql = sql.replace(/\bILIKE\b/gi, "LIKE");
          sql = sql.replace(/\bSIMILAR TO\b/gi, "REGEXP");
          sql = sql.replace(/\b::\w+\b/g, "");
          sql = sql.replace(/\bRETURNING\b.*$/gim, "");
          sql = sql.replace(
            /\bLIMIT\s+\d+\s+OFFSET\s+(\d+)\b/gi,
            "LIMIT $1, $2"
          );

          sql = sql.trim();
        } catch (sqlErr) {
          console.error("NL to SQL model failed:", sqlErr.message);
          return sendJSON(res, 500, {
            detail: [
              {
                loc: ["internal"],
                msg: `SQL generation failed: ${sqlErr.message}`,
                type: "internal_error",
              },
            ],
          });
        }

        console.log("Generated SQL:", sql);

        return sendJSON(res, 200, { response: sql });
      } catch (err) {
        console.error("API Generate error:", err.message);
        return sendJSON(res, 500, {
          detail: [
            {
              loc: ["internal"],
              msg: err.message,
              type: "internal_error",
            },
          ],
        });
      }
    }

    // API Config GET endpoint - proxy to external service
    if (method === "GET" && url.pathname === "/api/config") {
      try {
        const configRes = await fetch("http://192.168.1.113:8000/api/config");
        if (configRes.ok) {
          const configData = await configRes.json();
          return sendJSON(res, 200, configData);
        } else {
          // If external config fails, return error instead of showing static content
          console.warn("External config service unavailable");
          return sendJSON(res, 503, {
            error: "Configuration service temporarily unavailable",
            message: "Konfigürasyon servisi şu anda erişilemez",
            retry: true,
          });
        }
      } catch (err) {
        console.error("Config GET error:", err.message);
        // If external config fails, return error instead of showing static content
        return sendJSON(res, 503, {
          error: "Configuration service error",
          message: "Konfigürasyon servisi hatası",
          details: err.message,
          retry: true,
        });
      }
    }

    // API Config PUT endpoint - proxy to external service
    if (method === "PUT" && url.pathname === "/api/config") {
      try {
        const body = (await parseBody(req)) || {};

        // Forward request to external service
        const configRes = await fetch("http://192.168.1.113:8000/api/config", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (configRes.ok) {
          const result = await configRes.json();
          return sendJSON(res, 200, result);
        } else {
          const errorData = await configRes.json();
          return sendJSON(res, configRes.status, errorData);
        }
      } catch (err) {
        console.error("Config PUT error:", err.message);
        return sendJSON(res, 500, {
          detail: [
            {
              loc: ["internal"],
              msg: err.message,
              type: "internal_error",
            },
          ],
        });
      }
    }

    // Not found
    sendJSON(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: err.message || "Internal error" });
  }
});

server.listen(Number(PORT), () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`🔧 Debug mode: ${isDebugMode ? "🟢 ENABLED" : "🔴 DISABLED"}`);
  if (isDebugMode) {
    console.log("🔍 Debug endpoints available:");
    console.log("  POST /debug/toggle   - Toggle debug mode");
  }
});
