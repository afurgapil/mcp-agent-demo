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

export async function indexEntities(entities) {
  if (!Array.isArray(entities) || entities.length === 0)
    return { ok: true, count: 0 };
  const payload = { entities };
  return postJson("/entities/index", payload);
}

export async function searchEntities({ query, types = null, limit = 10 }) {
  if (!query || !EMBED_BASE) return { results: [] };
  const payload = { prompt: query, types, limit };
  return postJson("/entities/search", payload);
}

export default { indexEntities, searchEntities };
