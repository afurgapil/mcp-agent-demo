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
  CUSTOM_LLM_URL = "http://192.168.1.113:8002/api/generate",
  THINKING_LLM_URL = "http://192.168.1.113:8001/api/generate",
} = process.env;

if (!MCP_TOOLBOX_URL) {
  console.error("MCP_TOOLBOX_URL is required in .env");
  process.exit(1);
}
const MCP_BASE = MCP_TOOLBOX_URL.trim().replace(/\/$/, "");

// Check if thinking model is available
let thinkingModelAvailable = null;
async function checkThinkingModel() {
  if (thinkingModelAvailable !== null) return thinkingModelAvailable;

  try {
    const testRes = await fetch(THINKING_LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test", max_tokens: 10 }),
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });
    thinkingModelAvailable = testRes.ok;
    console.log(`Thinking model availability: ${thinkingModelAvailable}`);
  } catch (err) {
    thinkingModelAvailable = false;
    console.log(`Thinking model not available: ${err.message}`);
  }

  return thinkingModelAvailable;
}

// Thinking model - first stage LLM that processes user intent
async function callThinkingModel(userMessage, opts = {}) {
  const bodyPayload = {
    message: userMessage,
    max_tokens: opts.max_tokens || 200,
  };

  console.log(
    "Calling Thinking Model with:",
    JSON.stringify(bodyPayload, null, 2)
  );

  try {
    const res = await fetch(THINKING_LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    const data = await res.json();
    console.log("Thinking Model Response:", JSON.stringify(data, null, 2));

    if (!res.ok) {
      const errMsg = data?.error || data?.detail || res.statusText;
      throw new Error(`Thinking model error ${res.status}: ${errMsg}`);
    }

    const response = data?.response;
    if (!response) {
      console.log("Available thinking model data keys:", Object.keys(data));
      throw new Error("Empty response from thinking model");
    }

    return response;
  } catch (err) {
    console.log(`Thinking model call failed: ${err.message}`);
    throw err;
  }
}

// Fallback function when thinking model is not available
function processQueryWithoutThinking(userQuery) {
  console.log("Using fallback query processing (no thinking model)");

  // Simple query preprocessing without AI
  let processedQuery = userQuery.trim();

  // Basic Turkish to English technical terms
  const turkishTerms = {
    kamera: "camera",
    sensör: "sensor",
    sıcaklık: "temperature",
    veri: "data",
    göster: "show",
    getir: "get",
    listele: "list",
    sayı: "count",
    aktif: "active",
    pasif: "inactive",
  };

  // Replace Turkish terms
  for (const [turkish, english] of Object.entries(turkishTerms)) {
    processedQuery = processedQuery.replace(new RegExp(turkish, "gi"), english);
  }

  // Add helpful context for SQL generation
  if (processedQuery.toLowerCase().includes("camera")) {
    processedQuery += " (query about camera devices and their data)";
  } else if (processedQuery.toLowerCase().includes("temperature")) {
    processedQuery += " (query about temperature sensor readings)";
  } else if (processedQuery.toLowerCase().includes("sensor")) {
    processedQuery += " (query about sensor devices and signals)";
  }

  return processedQuery;
}

// NL to SQL model - second stage LLM that converts processed intent to SQL
async function generateText(prompt, opts = {}) {
  const bodyPayload = opts.payload || {
    prompt,
    max_length: Math.round(opts.max_length ?? 200),
  };

  console.log(
    "Calling NL to SQL Model with:",
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

      const text =
        data?.sql ||
        data?.generated_text ||
        data?.text ||
        data?.response ||
        data?.content ||
        data?.output ||
        data?.result ||
        data?.answer ||
        null;

      console.log("Extracted SQL text:", text);

      if (!text) {
        console.log("Available NL to SQL data keys:", Object.keys(data));
        throw new Error("Empty response from NL to SQL model");
      }

      return text;
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
  system_prompt: `You are a SQL Request Analyzer. Your job is to analyze user requests and database schemas, then create extremely clear and specific instructions for a SQL generation model.

CRITICAL: You do NOT generate SQL yourself. You only create detailed instructions.

Your task:
1. Analyze the user's natural language request
2. Examine the provided database schema  
3. Create precise, unambiguous instructions for the SQL generator

Output format should be a clear, structured instruction that includes:
- What type of SQL operation is needed (SELECT, INSERT, UPDATE, DELETE)
- Which specific tables and columns to use
- What conditions/filters to apply
- Any joins, aggregations, or sorting required
- Expected result format

Example good output:
"Create a SELECT query that retrieves customer names and email addresses from the 'customers' table where the registration date is within the last 30 days. Use the 'name', 'email', and 'created_at' columns. Filter using DATE_SUB with INTERVAL 30 DAY. Order results by registration date descending."

Be extremely specific about:
- Table names and column names (use exact names from schema)
- Date/time operations and formats
- Comparison operators and logic
- Join conditions if multiple tables are involved
- Aggregation functions if needed

Never include actual SQL code - only natural language instructions that are crystal clear.`,
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

    if (method === "POST" && url.pathname === "/thinking") {
      const body = (await parseBody(req)) || {};
      const { message, max_tokens } = body;
      if (!message || typeof message !== "string") {
        return sendJSON(res, 400, { error: "'message' (string) is required" });
      }

      const isThinkingAvailable = await checkThinkingModel();

      if (isThinkingAvailable) {
        try {
          const response = await callThinkingModel(message, { max_tokens });
          return sendJSON(res, 200, {
            originalMessage: message,
            response: response,
            stage: "thinking_only",
            modelUsed: "thinking_model",
          });
        } catch (err) {
          console.error("Thinking model error, using fallback:", err.message);
          const fallbackResponse = processQueryWithoutThinking(message);
          return sendJSON(res, 200, {
            originalMessage: message,
            response: fallbackResponse,
            stage: "thinking_fallback",
            modelUsed: "fallback_processing",
            warning: "Thinking model not available, used fallback processing",
          });
        }
      } else {
        const fallbackResponse = processQueryWithoutThinking(message);
        return sendJSON(res, 200, {
          originalMessage: message,
          response: fallbackResponse,
          stage: "thinking_fallback",
          modelUsed: "fallback_processing",
          info: "Thinking model not available, used fallback processing",
        });
      }
    }

    if (method === "POST" && url.pathname === "/nl") {
      const body = (await parseBody(req)) || {};
      const { query, customSchema } = body;
      if (!query || typeof query !== "string") {
        return sendJSON(res, 400, { error: "'query' (string) is required" });
      }

      console.log("=== Starting 2-Stage LLM Processing ===");
      console.log("Original user query:", query);

      // STAGE 1: Process user intent with thinking model or fallback
      let processedQuery;
      let thinkingStage = "pending";

      const isThinkingAvailable = await checkThinkingModel();

      if (isThinkingAvailable) {
        try {
          console.log("\n--- Stage 1: Thinking Model ---");
          processedQuery = await callThinkingModel(query, { max_tokens: 300 });
          console.log("Thinking model processed query:", processedQuery);
          thinkingStage = "completed";
        } catch (thinkingErr) {
          console.error(
            "Thinking model failed, using fallback:",
            thinkingErr.message
          );
          processedQuery = processQueryWithoutThinking(query);
          thinkingStage = "fallback";
        }
      } else {
        console.log(
          "\n--- Stage 1: Fallback Processing (No Thinking Model) ---"
        );
        processedQuery = processQueryWithoutThinking(query);
        console.log("Fallback processed query:", processedQuery);
        thinkingStage = "fallback";
      }

      // Use custom schema or fallback to static schema
      let schema = "";
      if (customSchema) {
        schema = customSchema;
      } else {
        // Static fallback schema
        schema = `
        -- Table for all devices
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
);

        `;
      }

      // STAGE 2: Convert processed query to SQL using NL to SQL model
      let rawResponse;
      try {
        console.log("\n--- Stage 2: NL to SQL Model ---");

        // Truncate very long schemas to prevent model overload
        let truncatedSchema = schema;
        if (schema.length > 4000) {
          truncatedSchema =
            schema.substring(0, 4000) +
            "\n-- Schema truncated for model stability";
          console.log("Schema truncated to prevent model overload");
        }

        rawResponse = await generateText("", {
          payload: {
            question: processedQuery,
            schema: truncatedSchema,
          },
          max_length: 500,
        });
      } catch (sqlErr) {
        console.error("NL to SQL model failed:", sqlErr.message);

        // Check if it's a connection issue
        const isConnectionError =
          sqlErr.message.includes("fetch failed") ||
          sqlErr.message.includes("timeout") ||
          sqlErr.message.includes("ECONNREFUSED");

        return sendJSON(res, 500, {
          error: "NL to SQL model failed",
          details: sqlErr.message,
          stage: "nl_to_sql",
          processedQuery: processedQuery,
          isConnectionError: isConnectionError,
          suggestion: isConnectionError
            ? "Check if NL to SQL model server is running"
            : "Model processing error",
        });
      }

      // Clean up SQL response
      let sql = (rawResponse || "").trim();

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

      // Remove CREATE TABLE statements (AI sometimes generates these unnecessarily)
      sql = sql.replace(/CREATE\s+TABLE[^;]*;?\s*/gi, "");

      // Evaluate completeness BEFORE altering with semicolons
      const parenOpen = (sql.match(/\(/g) || []).length;
      const parenClose = (sql.match(/\)/g) || []).length;
      const endsSuspicious = /[,(]$/.test(sql);
      const hasOpenCount = /COUNT\s*\(\s*[^)]*$/i.test(sql);
      if (!sql || parenOpen > parenClose || endsSuspicious || hasOpenCount) {
        return sendJSON(res, 200, {
          sql,
          executionResult: {
            isError: true,
            content: [
              {
                type: "text",
                text: "SQL appears incomplete (unbalanced parentheses or trailing token); not executing.",
              },
            ],
          },
        });
      }

      // Keep only the first complete statement (if multiple provided)
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
      sql = sql.replace(/\b::\w+\b/g, ""); // Remove type casting
      sql = sql.replace(/\bRETURNING\b.*$/gim, ""); // Remove RETURNING clauses
      sql = sql.replace(/\bLIMIT\s+\d+\s+OFFSET\s+(\d+)\b/gi, "LIMIT $1, $2"); // Convert LIMIT OFFSET to MySQL format

      // Final trim after all cleaning
      sql = sql.trim();

      // Block execution if SQL looks incomplete or ends mid-token
      const looksIncomplete =
        /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\b\s*$/i.test(
          sql
        ) ||
        /[,\(]$/.test(sql) ||
        /COUNT\s*\(\s*$/i.test(sql);
      if (!sql || looksIncomplete) {
        return sendJSON(res, 200, {
          sql,
          executionResult: {
            isError: true,
            content: [
              {
                type: "text",
                text: "SQL looks incomplete after cleaning; not executing. Please refine the question or provide a clearer schema.",
              },
            ],
          },
        });
      }

      // Execute SQL
      let executionResult = null;
      try {
        console.log("Executing SQL:", sql);
        executionResult = await callTool("mysql_execute_sql", { sql: sql });
        console.log("SQL execution result:", executionResult);
      } catch (execErr) {
        console.error("SQL execution failed:", execErr.message);
      }

      console.log("\n=== Final Response ===");
      console.log("Original query:", query);
      console.log("Processed query:", processedQuery);
      console.log("Generated SQL:", sql);
      console.log("Execution result:", executionResult);

      return sendJSON(res, 200, {
        originalQuery: query,
        processedQuery: processedQuery,
        sql: sql,
        executionResult: executionResult,
        stages: {
          thinking: thinkingStage,
          nlToSql: "completed",
          sqlExecution: executionResult ? "completed" : "failed",
        },
      });
    }

    // API Generate endpoint for SQL generation
    if (method === "POST" && url.pathname === "/api/generate") {
      const body = (await parseBody(req)) || {};
      const { message, max_tokens = 300 } = body;

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

        // STAGE 1: Process user intent with thinking model or fallback
        let processedQuery;
        const isThinkingAvailable = await checkThinkingModel();

        if (isThinkingAvailable) {
          try {
            console.log("\n--- Stage 1: Thinking Model ---");
            processedQuery = await callThinkingModel(message, {
              max_tokens: Math.min(max_tokens, 300),
            });
            console.log("Thinking model processed query:", processedQuery);
          } catch (thinkingErr) {
            console.error(
              "Thinking model failed, using fallback:",
              thinkingErr.message
            );
            processedQuery = processQueryWithoutThinking(message);
          }
        } else {
          console.log("\n--- Stage 1: Fallback Processing ---");
          processedQuery = processQueryWithoutThinking(message);
          console.log("Fallback processed query:", processedQuery);
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

          const rawResponse = await generateText("", {
            payload: {
              question: processedQuery,
              schema: schema,
              system_prompt: config.system_prompt,
            },
            max_length: Math.min(max_tokens, 500),
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

    // API Config GET endpoint
    if (method === "GET" && url.pathname === "/api/config") {
      try {
        const config = getConfig();
        return sendJSON(res, 200, {
          system_prompt: config.system_prompt,
          schema: config.schema,
        });
      } catch (err) {
        console.error("Config GET error:", err.message);
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

    // API Config PUT endpoint
    if (method === "PUT" && url.pathname === "/api/config") {
      try {
        const body = (await parseBody(req)) || {};
        const { system_prompt, schema } = body;

        const updates = {};
        if (system_prompt !== undefined) updates.system_prompt = system_prompt;
        if (schema !== undefined) updates.schema = schema;

        if (Object.keys(updates).length === 0) {
          return sendJSON(res, 422, {
            detail: [
              {
                loc: ["body"],
                msg: "At least one field (system_prompt or schema) is required",
                type: "value_error.missing",
              },
            ],
          });
        }

        const updatedConfig = saveConfig(updates);
        return sendJSON(res, 200, "Configuration updated successfully");
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
});
