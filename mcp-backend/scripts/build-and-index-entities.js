#!/usr/bin/env node
import "dotenv/config";
import fs from "fs";
import path from "path";

const EMBED_BASE = (process.env.EMBED_LLM_URL || "").replace(/\/$/, "");

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data?.detail || JSON.stringify(data);
    } catch {}
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json();
}

function readJson(file) {
  const abs = path.resolve(process.cwd(), file);
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

function normalizeEntities(list) {
  const results = [];
  let i = 0;
  for (const item of list) {
    if (!item) continue;
    const id = String(item.id ?? `ent_${i++}`);
    const type = String(item.type ?? "generic");
    const text = String(item.text ?? "").trim();
    if (!text) continue;
    const metadata =
      typeof item.metadata === "object" && item.metadata ? item.metadata : {};
    results.push({ id, type, text, metadata });
  }
  return results;
}

async function main() {
  const input = process.argv[2];
  if (!EMBED_BASE) throw new Error("EMBED_LLM_URL must be set");
  if (!input)
    throw new Error("Usage: build-and-index-entities.js <entities.json>");
  const data = readJson(input);
  const entities = Array.isArray(data)
    ? data
    : Array.isArray(data?.entities)
    ? data.entities
    : [];
  if (!entities.length) throw new Error("No entities found in input JSON");
  const normalized = normalizeEntities(entities);
  console.log(
    `Indexing ${normalized.length} entities to ${EMBED_BASE}/entities/index ...`
  );
  const resp = await postJson(`${EMBED_BASE}/entities/index`, {
    entities: normalized,
  });
  console.log("Done:", resp);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
