const { CUSTOM_API_BASE } = process.env;

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

export async function callCustomForSql({
  userPrompt,
  schema,
  systemPrompt,
  apiBase,
}) {
  let base = (apiBase || CUSTOM_API_BASE || "").trim();
  if (base && !/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  if (!base) {
    throw new Error("Custom provider apiBase is not configured");
  }

  const endpoint = new URL("/api/generate", base).toString();
  const body = {
    message: buildUserMessage(userPrompt, schema),
    // Defaults per swagger; can be omitted or customized later
    max_tokens: 300,
    temperature: 0.7,
    top_p: 0.95,
    repeat_penalty: 1.1,
  };

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
    (data && typeof data.response === "string" && data.response) || "";
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
