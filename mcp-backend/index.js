import "dotenv/config";
import { createServer } from "http";
import { URL } from "url";

const {
  MCP_TOOLBOX_URL,
  PORT = 3001,
  CUSTOM_LLM_URL = "http://192.168.1.113:8000/api/generate",
} = process.env;

if (!MCP_TOOLBOX_URL) {
  console.error("MCP_TOOLBOX_URL is required in .env");
  process.exit(1);
}
const MCP_BASE = MCP_TOOLBOX_URL.trim().replace(/\/$/, "");

// Simple HTTP LLM text generation
async function generateText(prompt, opts = {}) {
  const bodyPayload = opts.payload || {
    prompt,
    max_length: Math.round(opts.max_length ?? 200),
  };

  const res = await fetch(CUSTOM_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPayload),
  });

  const data = await res.json();
  console.log("HTTP Provider Response:", JSON.stringify(data, null, 2));

  if (!res.ok) {
    const errMsg = data?.error || data?.detail || res.statusText;
    throw new Error(`HTTP provider error ${res.status}: ${errMsg}`);
  }

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

  console.log("Extracted text:", text);

  if (!text) {
    console.log("Available data keys:", Object.keys(data));
    throw new Error("Empty response from HTTP provider");
  }
  return text;
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

// HTTP server helpers

// HTTP server (no external dependencies)
function sendJSON(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  try {
    if (method === "GET" && url.pathname === "/health") {
      return sendJSON(res, 200, { ok: true });
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

    if (method === "POST" && url.pathname === "/nl") {
      const body = (await parseBody(req)) || {};
      const { query, customSchema } = body;
      if (!query || typeof query !== "string") {
        return sendJSON(res, 400, { error: "'query' (string) is required" });
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

      // Generate SQL using AI
      const rawResponse = await generateText("", {
        payload: {
          question: ` ${query}`,
          schema: schema,
        },
        max_length: 500,
      });

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

      return sendJSON(res, 200, {
        sql: sql,
        executionResult: executionResult,
      });
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
