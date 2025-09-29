import { extractSqlFromText } from "./sql-extractor.js";

const { CUSTOM_API_BASE } = process.env;

function buildUserMessage(userPrompt) {
  return userPrompt.trim();
}

function resolveApiBase(apiBase) {
  let base = (apiBase || CUSTOM_API_BASE || "").trim();
  if (base && !/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  if (!base) {
    throw new Error("Custom provider apiBase is not configured");
  }
  return base;
}

export async function callCustomChat({
  systemPrompt,
  userPrompt,
  apiBase,
  temperature,
  maxTokens,
}) {
  const base = resolveApiBase(apiBase);
  const endpoint = new URL("/api/generate", base).toString();
  const promptParts = [];
  if (systemPrompt && systemPrompt.trim()) {
    promptParts.push(systemPrompt.trim());
  }
  if (userPrompt && userPrompt.trim()) {
    promptParts.push(userPrompt.trim());
  }
  const message = promptParts.join("\n\n");

  const body = {
    message,
    prompt: userPrompt,
  };
  if (systemPrompt && systemPrompt.trim()) {
    body.few_shot_prefix = systemPrompt.trim();
  }
  if (Number.isFinite(maxTokens)) {
    body.max_new_tokens = Number(maxTokens);
  }
  if (Number.isFinite(temperature)) {
    body.temperature = Number(temperature);
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail?.[0]?.msg || data?.message || res.statusText;
    throw new Error(`Custom API error ${res.status}: ${msg}`);
  }
  const content =
    (typeof data?.completion === "string" && data.completion) ||
    (typeof data?.response === "string" && data.response) ||
    "";
  if (!content) {
    throw new Error("Custom API returned empty response");
  }

  return {
    content,
    response: data,
    request: body,
    usage: data?.usage || undefined,
  };
}

export async function callCustomForSql({
  userPrompt,
  schema,
  systemPrompt,
  apiBase,
}) {
  const base = resolveApiBase(apiBase);

  const body = {
    message: buildUserMessage(userPrompt),
    prompt: userPrompt,
  };

  const res = await fetch(new URL("/api/generate", base).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail?.[0]?.msg || data?.message || res.statusText;
    throw new Error(`Custom API error ${res.status}: ${msg}`);
  }

  const content =
    (typeof data?.completion === "string" && data.completion) ||
    (typeof data?.response === "string" && data.response) ||
    "";
  if (!content) {
    throw new Error("Custom API returned empty response");
  }
  const sql = extractSqlFromText(content);
  if (!sql) {
    throw new Error("Custom API response did not include SQL");
  }

  return {
    sql,
    rawContent: content,
    response: data,
    request: body,
    usage: undefined,
  };
}
