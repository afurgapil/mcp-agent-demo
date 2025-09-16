import "dotenv/config";
import { createServer } from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { URL } from "url";
// Using MCP SSE; no direct DB fallback

// Ensure required env vars (based on provider)
const {
  LLM_PROVIDER = "gemini", // gemini | lmstudio | openai | ollama
  GEMINI_API_KEY,
  MCP_TOOLBOX_URL,
  PORT = 3001,
  // OpenAI-compatible (LM Studio, vLLM, etc.)
  OPENAI_BASE_URL = "http://127.0.0.1:1234/v1",
  OPENAI_API_KEY = "lm-studio",
  OPENAI_MODEL = "local-model",
  // Ollama
  OLLAMA_BASE_URL = "http://127.0.0.1:11434",
  OLLAMA_MODEL = "llama3.1:8b",
} = process.env;

if (LLM_PROVIDER === "gemini" && !GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is required when LLM_PROVIDER=gemini");
  process.exit(1);
}
if (!MCP_TOOLBOX_URL) {
  console.error("MCP_TOOLBOX_URL is required in .env");
  process.exit(1);
}
const MCP_BASE = MCP_TOOLBOX_URL.trim().replace(/\/$/, "");

// LLM provider setup
let GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash-8b";
let model = null;
if (LLM_PROVIDER === "gemini") {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  console.log(`Using provider=gemini model=${GEMINI_MODEL}`);
} else if (LLM_PROVIDER === "lmstudio" || LLM_PROVIDER === "openai") {
  console.log(
    `Using provider=${LLM_PROVIDER} baseURL=${OPENAI_BASE_URL} model=${OPENAI_MODEL}`
  );
} else if (LLM_PROVIDER === "ollama") {
  console.log(
    `Using provider=ollama baseURL=${OLLAMA_BASE_URL} model=${OLLAMA_MODEL}`
  );
} else {
  console.warn(
    `Unknown LLM_PROVIDER='${LLM_PROVIDER}', defaulting to gemini. Set LLM_PROVIDER to one of: gemini | lmstudio | openai | ollama.`
  );
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
}

// Provider-agnostic text generation
async function generateText(prompt, opts = {}) {
  const temperature = opts.temperature ?? 0.2;
  if (LLM_PROVIDER === "gemini") {
    const resp = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }]}],
      generationConfig: { temperature },
    });
    return resp.response.text();
  }
  if (LLM_PROVIDER === "lmstudio" || LLM_PROVIDER === "openai") {
    // OpenAI-compatible Chat Completions
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        `OpenAI-compatible error ${res.status}: ${data?.error?.message || res.statusText}`
      );
    }
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response from OpenAI-compatible server");
    return text;
  }
  if (LLM_PROVIDER === "ollama") {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        `Ollama error ${res.status}: ${data?.error || res.statusText}`
      );
    }
    if (!data?.response) throw new Error("Empty response from Ollama");
    return data.response;
  }
  // Fallback to gemini behavior
  const resp = await model.generateContent(prompt);
  return resp.response.text();
}

// All tools are allowed by default

// Simple helper: fetch JSON with error handling
async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    throw new Error(`Invalid JSON from ${url}: ${text?.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data && data.error
        ? data.error
        : res.statusText;
    throw new Error(`HTTP ${res.status} ${msg}`);
  }
  return data;
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
  const map = {
    describe_table: { table: "tableName", table_name: "tableName" },
    list_table: { table: "tableName", table_name: "tableName" },
    list_table_limited: { table: "tableName", table_name: "tableName" },
    list_table_where: { table: "tableName", table_name: "tableName" },
    select_columns_where: {
      table: "tableName",
      table_name: "tableName",
      order_by: "orderBy",
    },
    insert_values: { table: "tableName", table_name: "tableName" },
    update_where: {
      table: "tableName",
      table_name: "tableName",
      set: "setClause",
      set_clause: "setClause",
    },
    delete_where: { table: "tableName", table_name: "tableName" },
    create_table_like: {
      source: "sourceTable",
      target: "targetTable",
      source_table: "sourceTable",
      target_table: "targetTable",
    },
    copy_last_n_rows: { source: "sourceTable", target: "targetTable" },
    delete_last_n_rows: { source: "sourceTable" },
    get_url_by_short_code: { short_code: "shortUrl", short: "shortUrl" },
  };
  const m = map[toolName];
  if (m) {
    for (const [from, to] of Object.entries(m)) {
      if (a[from] !== undefined && a[to] === undefined) {
        a[to] = a[from];
        delete a[from];
      }
    }
  }
  // Defaults and light normalization
  if (toolName === "list_table_where") {
    if (a.limit == null) a.limit = 50;
    if (typeof a.where === "string") {
      // Avoid Turkish diacritics in identifiers
      const diacriticMap = {
        ı: "i",
        İ: "I",
        ş: "s",
        Ş: "S",
        ğ: "g",
        Ğ: "G",
        ç: "c",
        Ç: "C",
        ö: "o",
        Ö: "O",
        ü: "u",
        Ü: "U",
      };
      a.where = a.where.replace(
        /[ıİşŞğĞçÇöÖüÜ]/g,
        (ch) => diacriticMap[ch] || ch
      );
    }
  }
  // Basic trimming for common string fields
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

// No virtual/composite tools; planning uses toolbox tools and may fall back to mysql_execute_sql

// Gemini: plan tool call from NL (English prompt for better model performance)
function buildPlanningPrompt(userQuery, tools) {
  const toolNames = (Array.isArray(tools) ? tools : [])
    .map((t) => (typeof t === "string" ? t : t.name))
    .filter(Boolean);
  const toolsList = (Array.isArray(tools) ? tools : [])
    .map((t) =>
      typeof t === "string"
        ? `- ${t}`
        : `- ${t.name}${t.description ? `: ${t.description}` : ""}`
    )
    .join("\n");

  // Keep guidance generic; avoid referencing specific tool names

  return `You are a strict planner that composes one or more MCP tools to satisfy a MySQL-related user request.

Available tools (use only these):\n${toolsList}\n\n
Output strictly as JSON only:
{
  "steps": [ { "tool": string, "args": object } ],
  "rationale": string
}

Guidelines:
- Prefer dedicated tools first. Use "mysql_execute_sql" only when a required operation cannot be expressed with existing tools.
- Multi-step is encouraged. If the target table may not exist, first use an appropriate create-table tool (if available), then an appropriate copy/select tool — choose from the available tools listed above.
- For ambiguous names (e.g., aliases like "sa gateway"), do not guess a table. First discover using mysql_execute_sql with "SHOW TABLES;" (case-insensitive compare; normalize spaces vs underscores). Optionally run "DESCRIBE <table>;" to confirm before reading/writing.
- Before INSERT/UPDATE, always DESCRIBE the target table and include ONLY existing, non-auto-increment columns in the column list (e.g., exclude id). Use exact column names; do not invent. Use backticks around identifiers.
- For list_table_where always include a LIMIT (e.g., 50).
- Never use locale-specific letters in identifiers (ı,İ,ş,Ş,ğ,Ğ,ç,Ç,ö,Ö,ü,Ü). Use the ASCII names exactly as returned by DESCRIBE (e.g., gateway_adi).
- Keep raw SQL minimal and safe (max 1–2 statements per step). Avoid destructive operations (DROP/ALTER/TRUNCATE/GRANT/REVOKE). Require WHERE for UPDATE/DELETE unless the user explicitly asks for all rows.
- When reading data, default to a sensible LIMIT (e.g., 50) unless the user asks otherwise.
- Ensure correct value types (numbers vs strings).
- If the goal is not achievable, return steps: [] with a clear rationale.
- Do not output Markdown or code fences; JSON only.`;
}

function buildReactPrompt(userQuery, tools, history) {
  const toolsList = (Array.isArray(tools) ? tools : [])
    .map((t) => (typeof t === "string" ? t : t.name))
    .filter(Boolean)
    .map((n) => `- ${n}`)
    .join("\n");

  const historyText = (history || [])
    .map((h, i) => {
      const res = h.error
        ? `error: ${h.error}`
        : h.resultSnippet || JSON.stringify(h.result || {}).slice(0, 400);
      return `#${i + 1} tool=${h.tool} args=${JSON.stringify(
        h.args
      )} -> ${res}`;
    })
    .join("\n");

  return `You are an iterative planner-executor for MySQL via MCP tools. Plan one tool call at a time based on the user's request and prior step results.\n\nUser request:\n${userQuery}\n\nAvailable tools:\n${toolsList}\n\nPrior steps (most recent last):\n${
    historyText || "(none)"
  }\n\nReturn ONLY JSON with one of:\n- {\n  \"action\": \"continue\",\n  \"step\": { \"tool\": string, \"args\": object },\n  \"rationale\": string\n}\n- {\n  \"action\": \"finish\",\n  \"rationale\": string\n}\n\nRules:\n- Prefer dedicated tools first; use mysql_execute_sql only when necessary.\n- For ambiguous table names, first run SHOW TABLES (show_tables) and pick best match; optionally DESCRIBE before queries.\n- Before INSERT/UPDATE, DESCRIBE the target, then use ONLY real, non-auto-increment columns. Never invent names like column1/2/3. Use backticks for identifiers.\n- Keep raw SQL minimal (max 1–2 statements). Avoid destructive ops unless explicitly asked.\n- If enough info is gathered and the goal is met, action=finish with rationale.\n- JSON only; no code fences.`;
}

async function runInteractiveExecution(
  userQuery,
  maxSteps = Number.POSITIVE_INFINITY
) {
  const tools = await listTools();
  const history = [];
  for (let i = 0; i < maxSteps; i++) {
    const prompt = buildReactPrompt(userQuery, tools, history);
    const raw = await generateText(prompt);
    const m = raw.match(/\{[\s\S]*\}/);
    const jsonStr = m ? m[0] : raw;
    let plan;
    try {
      plan = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(`Planner JSON parse error: ${raw.slice(0, 400)}`);
    }
    if (plan.action === "finish") {
      return { steps: history, rationale: plan.rationale };
    }
    if (plan.action === "continue" && plan.step && plan.step.tool) {
      const { tool, args = {} } = plan.step;
      try {
        const result = await callTool(tool, args);
        // Prepare a concise snippet for next iteration (especially for DESCRIBE)
        let resultSnippet = undefined;
        if (Array.isArray(result?.content)) {
          const lines = result.content
            .map((c) => (c && c.text ? c.text : ""))
            .filter(Boolean)
            .slice(0, 12)
            .join("\n");
          resultSnippet = lines.slice(0, 800);
        }
        history.push({ tool, args, result, resultSnippet });
      } catch (err) {
        history.push({ tool, args, error: err.message || String(err) });
        // Give the planner a chance to recover on next loop
      }
    } else {
      throw new Error(`Planner returned invalid object: ${raw.slice(0, 400)}`);
    }
  }
  return { steps: history, rationale: "Stopped without explicit finish" };
}

// Gemini: summarize the DB result for the end user (English)
async function summarizeResult(userQuery, plan, execution, locale) {
  const languageName =
    locale === "tr" ? "Turkish" : locale === "de" ? "German" : "English";
  const summaryPrompt = `User request: ${userQuery}\n\nStep count: ${
    (plan.steps || []).length
  }\nPlan: ${JSON.stringify(
    plan
  )}\n\nExecution results (JSON): ${JSON.stringify(
    execution
  )}\n\nWrite a brief, clear summary for the end user in ${languageName}. Avoid unnecessary technical details.`;
  return await generateText(summaryPrompt);
}

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
      const { query } = body;
      if (!query || typeof query !== "string") {
        return sendJSON(res, 400, { error: "'query' (string) is required" });
      }

      // Resolve requested locale: prefer body.locale, then Accept-Language
      function resolveLocale() {
        const supported = ["en", "tr", "de"];
        const bodyLocale =
          typeof body.locale === "string" ? body.locale.toLowerCase() : null;
        if (bodyLocale && supported.includes(bodyLocale)) return bodyLocale;
        const al = (req.headers["accept-language"] || "").toLowerCase();
        if (al.includes("tr")) return "tr";
        if (al.includes("de")) return "de";
        return "en";
      }
      const locale = resolveLocale();

      const exec = await runInteractiveExecution(query);
      const steps = exec.steps.map((s, i) => ({
        index: i,
        tool: s.tool,
        args: s.args,
        ...(s.error ? { error: s.error } : { result: s.result }),
      }));
      const summary = await summarizeResult(query, { steps }, steps, locale);
      const final = steps[steps.length - 1];
      return sendJSON(res, 200, {
        plan: { steps, rationale: exec.rationale },
        steps,
        result: final?.result,
        summary,
        locale,
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
