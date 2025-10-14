#!/usr/bin/env node
import "dotenv/config";
import fs from "fs";
import path from "path";
import { listTools, callTool } from "../src/services/mcp.service.js";
import { indexEntities } from "../src/services/retrieval.service.js";

function hasTool(tools, name) {
  if (!Array.isArray(tools)) return false;
  return tools.some(
    (t) => (t?.name || "").toLowerCase() === name.toLowerCase()
  );
}

async function runQuery(sql) {
  const result = await callTool("postgres_execute_sql", { sql });
  // Expecting structured data from MCP; try to normalize
  const content = result?.content ?? result;
  if (Array.isArray(content)) return content;
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function pluckDistinct(rows, key) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const value = row?.[key];
    if (value == null) continue;
    const text = String(value).trim();
    const lower = text.toLowerCase();
    if (!text || seen.has(lower)) continue;
    seen.add(lower);
    out.push(text);
  }
  return out;
}

function toEntities({ locations, deviceTypes, deviceNames }) {
  const entities = [];
  let i = 0;
  for (const name of locations || []) {
    entities.push({
      id: `loc_${i++}_${name}`,
      type: "location",
      text: name,
      metadata: { source: "postgres", table: "locations", column: "name" },
    });
  }
  i = 0;
  for (const typ of deviceTypes || []) {
    entities.push({
      id: `dtype_${i++}_${typ}`,
      type: "device_type",
      text: typ,
      metadata: { source: "postgres", table: "devices", column: "type" },
    });
  }
  i = 0;
  for (const dn of deviceNames || []) {
    entities.push({
      id: `dname_${i++}_${dn}`,
      type: "device_name",
      text: dn,
      metadata: { source: "postgres", table: "devices", column: "name" },
    });
  }
  return entities;
}

async function main() {
  // optional: --out <path> to write discovered entities to JSON
  let outPath = null;
  const outIdx = process.argv.indexOf("--out");
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    outPath = path.resolve(process.cwd(), process.argv[outIdx + 1]);
  }

  // optional: --schema <path> to guide queries using schema.summary.json
  let schemaPath = null;
  const schemaIdx = process.argv.indexOf("--schema");
  if (schemaIdx !== -1 && process.argv[schemaIdx + 1]) {
    schemaPath = path.resolve(process.cwd(), process.argv[schemaIdx + 1]);
  } else {
    const defaultSchema = path.resolve(
      process.cwd(),
      "mcp-backend/reports/schema.summary.json"
    );
    if (fs.existsSync(defaultSchema)) schemaPath = defaultSchema;
  }

  let schema = null;
  if (schemaPath && fs.existsSync(schemaPath)) {
    try {
      schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    } catch {}
  }

  const tools = await listTools();
  if (!hasTool(tools, "postgres_execute_sql")) {
    throw new Error("postgres_execute_sql tool is not available via MCP");
  }

  // Build queries based on schema (fallbacks included)
  const hasTable = (table) =>
    Array.isArray(schema?.tables) &&
    schema.tables.some((t) => t?.name === table);
  const hasColumn = (table, col) => {
    if (!Array.isArray(schema?.tables)) return true; // optimistic when schema missing
    const t = schema.tables.find((t) => t?.name === table);
    return Array.isArray(t?.columns) && t.columns.some((c) => c?.name === col);
  };

  const qLocations =
    hasTable("locations") && hasColumn("locations", "name")
      ? "SELECT DISTINCT name FROM locations WHERE name IS NOT NULL AND name <> '' LIMIT 10000"
      : hasTable("devices") && hasColumn("devices", "location")
      ? "SELECT DISTINCT location AS name FROM devices WHERE location IS NOT NULL AND location <> '' LIMIT 10000"
      : null;

  const qDeviceTypes =
    hasTable("devices") && hasColumn("devices", "type")
      ? "SELECT DISTINCT type FROM devices WHERE type IS NOT NULL AND type <> '' LIMIT 10000"
      : null;

  const qDeviceNames =
    hasTable("devices") && hasColumn("devices", "name")
      ? "SELECT DISTINCT name FROM devices WHERE name IS NOT NULL AND name <> '' LIMIT 10000"
      : null;

  const [rowsLoc, rowsType, rowsName] = await Promise.all([
    qLocations ? runQuery(qLocations) : Promise.resolve([]),
    qDeviceTypes ? runQuery(qDeviceTypes) : Promise.resolve([]),
    qDeviceNames ? runQuery(qDeviceNames) : Promise.resolve([]),
  ]);

  const locations = pluckDistinct(rowsLoc, "name");
  let deviceTypes = pluckDistinct(rowsType, "type");
  const deviceNames = pluckDistinct(rowsName, "name");

  // If schema declares enum values for devices.type, include them regardless of row counts
  try {
    const devices = Array.isArray(schema?.tables)
      ? schema.tables.find((t) => t?.name === "devices")
      : null;
    const typeCol = Array.isArray(devices?.columns)
      ? devices.columns.find((c) => c?.name === "type")
      : null;
    if (
      typeCol &&
      Array.isArray(typeCol.enum_values) &&
      typeCol.enum_values.length
    ) {
      const merged = new Set([...(deviceTypes || [])]);
      for (const v of typeCol.enum_values) {
        if (typeof v === "string" && v.trim()) merged.add(v.trim());
      }
      deviceTypes = Array.from(merged);
    }
  } catch {}

  const entities = toEntities({ locations, deviceTypes, deviceNames });
  if (outPath) {
    const json = JSON.stringify(entities, null, 2);
    fs.writeFileSync(outPath, json, "utf8");
    console.log(`Wrote ${entities.length} entities to ${outPath}`);
  }
  if (!entities.length) {
    console.log("No entities found to index.");
    setImmediate(() => process.exit(0));
    return;
  }

  console.log(`Indexing ${entities.length} entities to embedding service...`);
  const resp = await indexEntities(entities);
  console.log("Done:", resp);
  // ensure clean exit (avoid hanging due to open SSE connections)
  setImmediate(() => process.exit(0));
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
