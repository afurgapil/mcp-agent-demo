import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { execFile } from "child_process";
import mysql from "mysql2/promise";
import { fileURLToPath } from "url";
import { callTool, listTools } from "../services/mcp.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "../../");

const SCHEMA_SUMMARY_FILE = join(ROOT_DIR, "reports/schema.summary.json");
const SCHEMA_BUNDLE_FILE = join(ROOT_DIR, "reports/schema.bundle.txt");
const PRISMA_SCHEMA_FILE = join(ROOT_DIR, "prisma/schema.prisma");

const AUTO_SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedAutoSchema = "";
let cachedAutoSchemaTimestamp = 0;

export function tryLoadSchemaSummary() {
  try {
    if (!existsSync(SCHEMA_SUMMARY_FILE)) return null;
    const text = readFileSync(SCHEMA_SUMMARY_FILE, "utf8").trim();
    if (!text) return null;
    return text;
  } catch {
    return null;
  }
}

function runExportBundle() {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.platform === "win32" ? "node.exe" : "node",
      ["./scripts/export-prisma-schema.js"],
      { cwd: ROOT_DIR, env: process.env },
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

async function runPrismaDbPullInProcess() {
  return new Promise((resolvePromise, reject) => {
    const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
    execFile(
      cmd,
      ["prisma", "db", "pull"],
      { cwd: ROOT_DIR, env: process.env },
      (err) => {
        if (err) return reject(err);
        resolvePromise();
      }
    );
  });
}

async function fetchViewsSqlFromMySql() {
  const { MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE } =
    process.env;
  if (!MYSQL_USER || !MYSQL_DATABASE)
    return "-- No MySQL credentials; skipping views";
  const conn = await mysql.createConnection({
    host: MYSQL_HOST || "localhost",
    port: Number(MYSQL_PORT) || 3306,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
  });
  try {
    const [rows] = await conn.execute(
      `SELECT TABLE_SCHEMA, TABLE_NAME, VIEW_DEFINITION
       FROM information_schema.VIEWS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [MYSQL_DATABASE]
    );
    if (!rows.length) return "-- No views found";
    return rows
      .map((r) => {
        const name = `\`${r.TABLE_SCHEMA}\`.\`${r.TABLE_NAME}\``;
        return `DROP VIEW IF EXISTS ${name};\nCREATE OR REPLACE VIEW ${name} AS\n${r.VIEW_DEFINITION};`;
      })
      .join("\n\n");
  } finally {
    await conn.end();
  }
}

export async function buildSchemaBundle({ introspect = false } = {}) {
  try {
    if (introspect) {
      await runPrismaDbPullInProcess();
    }
  } catch (err) {
    console.warn("Prisma introspection failed:", err?.message || err);
  }

  let prismaSchema = "";
  try {
    if (existsSync(PRISMA_SCHEMA_FILE)) {
      prismaSchema = readFileSync(PRISMA_SCHEMA_FILE, "utf8");
    }
  } catch {}

  let viewsSql = "";
  try {
    viewsSql = await fetchViewsSqlFromMySql();
  } catch (err) {
    viewsSql = `-- Failed to fetch views: ${err?.message || err}`;
  }

  const bundle = [
    "# Prisma schema snapshot\n",
    "```prisma\n",
    prismaSchema || "// empty",
    "\n```\n\n",
    "# MySQL views (generated)\n",
    "```sql\n",
    viewsSql || "-- empty",
    "\n```\n",
  ].join("");
  return bundle;
}

export async function getFreshSchemaBundle() {
  // Build in-process; avoid writing files to prevent nodemon restarts
  return buildSchemaBundle({ introspect: true });
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function updateUsageCsv({
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = 0,
  schemaSource = "",
}) {
  try {
    const USAGE_CSV_FILE = join(ROOT_DIR, "reports/deepseek_usage.csv");
    const header =
      "timestamp,prompt_tokens,completion_tokens,total_tokens,schema_source\n";
    let lines = [];
    if (existsSync(USAGE_CSV_FILE)) {
      const raw = readFileSync(USAGE_CSV_FILE, "utf8");
      lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    }

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

export async function fetchSchemaFromMcp({ maxTables = 25 } = {}) {
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

export async function getAutoSchemaFromCache() {
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

// Simple, robust schema getter: no writes, no introspection, no cache
export function getSchemaForPromptSimple() {
  try {
    // Prefer prisma schema if exists
    if (existsSync(PRISMA_SCHEMA_FILE)) {
      const text = readFileSync(PRISMA_SCHEMA_FILE, "utf8").trim();
      if (text) {
        return { schema: text, source: "prisma-file" };
      }
    }
    // Fallback to summary file (JSON string content)
    if (existsSync(SCHEMA_SUMMARY_FILE)) {
      const text = readFileSync(SCHEMA_SUMMARY_FILE, "utf8").trim();
      if (text) {
        return { schema: text, source: "file" };
      }
    }
  } catch {}
  return { schema: "", source: "none" };
}
