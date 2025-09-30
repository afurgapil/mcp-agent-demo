import "dotenv/config";

const EMBED_BASE = (process.env.EMBED_LLM_URL || "").replace(/\/$/, "");

async function postJson(path, body) {
  if (!EMBED_BASE) {
    throw new Error("EMBED_LLM_URL is not configured");
  }
  const url = `${EMBED_BASE}${path}`;
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
    throw new Error(`Embedding service error ${res.status}: ${detail}`);
  }
  return res.json();
}

export async function rankToolsWithEmbedding({
  prompt,
  limit = 8,
  schema = null,
  systemPrompt = null,
}) {
  if (!EMBED_BASE) return null;
  try {
    const payload = { prompt, limit };
    if (schema) {
      payload.schema =
        typeof schema === "string" ? schema : JSON.stringify(schema);
    }
    if (systemPrompt) {
      payload.system_prompt = systemPrompt;
    }
    const response = await postJson("/rank/tools", payload);
    return response;
  } catch (err) {
    console.warn("Embedding rank tools failed:", err.message);
    return null;
  }
}

export async function rankTablesWithEmbedding({
  prompt,
  limit = 3,
  schema = null,
  systemPrompt = null,
}) {
  if (!EMBED_BASE) return null;
  try {
    const payload = { prompt, limit };
    if (schema) {
      payload.schema =
        typeof schema === "string" ? schema : JSON.stringify(schema);
    }
    if (systemPrompt) {
      payload.system_prompt = systemPrompt;
    }
    const response = await postJson("/rank/tables", payload);
    return response;
  } catch (err) {
    console.warn("Embedding rank tables failed:", err.message);
    return null;
  }
}

export async function getEmbeddingInfo() {
  if (!EMBED_BASE) return null;
  try {
    const res = await fetch(`${EMBED_BASE}/toolset/info`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function embedTexts(texts) {
  if (!EMBED_BASE) return null;
  if (!Array.isArray(texts) || texts.length === 0) return null;
  try {
    const payload = { texts };
    const response = await postJson("/embed", payload);
    return response;
  } catch (err) {
    console.warn("Embedding request failed:", err.message);
    return null;
  }
}
