import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sendJSON } from "../utils/response.js";
import { getConfig, saveConfig } from "../services/config.service.js";
import { getEmbeddingInfo } from "../services/embedding.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "../../");
const TOOLSET_SNAPSHOT = join(ROOT_DIR, "reports/toolset.snapshot.json");
const SCHEMA_SNAPSHOT = join(ROOT_DIR, "reports/schema.summary.json");
const EMBED_BASE = (process.env.EMBED_LLM_URL || "").trim().replace(/\/$/, "");

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf8");
    return JSON.parse(content);
  } catch (err) {
    console.warn(`Failed to parse JSON file ${path}:`, err.message);
    return null;
  }
}

async function putEmbedding(path, payload) {
  const url = `${EMBED_BASE}${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Embedding service ${path} failed ${res.status}: ${detail}`);
  }
}

async function pushEmbeddingConfig({ pushToolset = false, pushSchema = false } = {}) {
  if (!EMBED_BASE) return;
  const tasks = [];
  if (pushToolset) {
    tasks.push(
      (async () => {
        const snapshot = readJsonFile(TOOLSET_SNAPSHOT);
        if (!snapshot) {
          console.warn("Toolset snapshot not found; skipping embedding sync");
          return;
        }
        try {
          await putEmbedding("/config/toolset", snapshot);
        } catch (err) {
          console.warn(err.message);
        }
      })()
    );
  }
  if (pushSchema) {
    tasks.push(
      (async () => {
        const schema = readJsonFile(SCHEMA_SNAPSHOT);
        if (!schema) {
          console.warn("Schema summary not found; skipping schema embedding sync");
          return;
        }
        try {
          await putEmbedding("/config/schema", schema);
        } catch (err) {
          console.warn(err.message);
        }
      })()
    );
  }
  await Promise.all(tasks);
}

export async function getConfigHandler(req, res) {
  const config = getConfig();
  const providerFromQuery =
    typeof req.query?.provider === "string" ? req.query.provider.trim() : "";
  const providerFromHeader =
    typeof req.headers["x-provider"] === "string"
      ? String(req.headers["x-provider"]).trim()
      : "";
  const provider =
    providerFromQuery ||
    providerFromHeader ||
    config?.defaultProvider ||
    "deepseek";
  if (provider === "custom") {
    try {
      let apiBase =
        config?.providers?.custom?.apiBase || process.env.CUSTOM_API_BASE;
      if (apiBase && !/^https?:\/\//i.test(apiBase))
        apiBase = `http://${apiBase}`;
      apiBase = (apiBase || "").trim();
      if (!apiBase)
        return sendJSON(res, 500, {
          error: "Custom provider apiBase is not configured",
        });
      const endpoint = new URL("/api/config", apiBase).toString();
      const r = await fetch(endpoint, { method: "GET" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return sendJSON(res, r.status, data);
      const embeddingUrl = (process.env.EMBED_LLM_URL || "").trim();
      let embeddingStatus = null;
      if (embeddingUrl) {
        try {
          embeddingStatus = await getEmbeddingInfo();
        } catch (err) {
          console.warn("Embedding status fetch failed:", err?.message);
        }
      }
      return sendJSON(res, 200, {
        ...data,
        embedding: {
          url: embeddingUrl || null,
          status: embeddingStatus,
        },
      });
    } catch (err) {
      return sendJSON(res, 500, {
        error: "Custom config fetch failed",
        message: err?.message,
      });
    }
  }
  const embeddingUrl = (process.env.EMBED_LLM_URL || "").trim();
  let embeddingStatus = null;
  if (embeddingUrl) {
    try {
      embeddingStatus = await getEmbeddingInfo();
    } catch (err) {
      console.warn("Embedding status fetch failed:", err?.message);
    }
  }
  return sendJSON(res, 200, {
    ...config,
    embedding: {
      url: embeddingUrl || null,
      status: embeddingStatus,
    },
  });
}

export async function putConfigHandler(req, res) {
  const config = getConfig();
  const providerFromQuery =
    typeof req.query?.provider === "string" ? req.query.provider.trim() : "";
  const providerFromHeader =
    typeof req.headers["x-provider"] === "string"
      ? String(req.headers["x-provider"]).trim()
      : "";
  const providerFromBody =
    req.body && typeof req.body.provider === "string"
      ? String(req.body.provider).trim()
      : "";
  const provider =
    providerFromQuery ||
    providerFromHeader ||
    providerFromBody ||
    config?.defaultProvider ||
    "deepseek";
  if (provider === "custom") {
    try {
      let apiBase =
        config?.providers?.custom?.apiBase || process.env.CUSTOM_API_BASE;
      if (apiBase && !/^https?:\/\//i.test(apiBase))
        apiBase = `http://${apiBase}`;
      apiBase = (apiBase || "").trim();
      if (!apiBase)
        return sendJSON(res, 500, {
          error: "Custom provider apiBase is not configured",
        });
      const endpoint = new URL("/api/config", apiBase).toString();
      const r = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          (() => {
            const b = { ...(req.body || {}) };
            if ("provider" in b) delete b.provider;
            return b;
          })()
        ),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return sendJSON(res, r.status, data);
      await pushEmbeddingConfig({ pushToolset: true, pushSchema: true }).catch(
        () => {}
      );
      const embeddingUrl = (process.env.EMBED_LLM_URL || "").trim();
      let embeddingStatus = null;
      if (embeddingUrl) {
        try {
          embeddingStatus = await getEmbeddingInfo();
        } catch (err) {
          console.warn("Embedding status fetch failed:", err?.message);
        }
      }
      return sendJSON(res, 200, {
        ...data,
        embedding: {
          url: embeddingUrl || null,
          status: embeddingStatus,
        },
      });
    } catch (err) {
      return sendJSON(res, 500, {
        error: "Custom config update failed",
        message: err?.message,
      });
    }
  }
  try {
    const updated = saveConfig(req.body || {});
    await pushEmbeddingConfig({ pushToolset: true, pushSchema: true }).catch(
      () => {}
    );
    const embeddingUrl = (process.env.EMBED_LLM_URL || "").trim();
    let embeddingStatus = null;
    if (embeddingUrl) {
      try {
        embeddingStatus = await getEmbeddingInfo();
      } catch (err) {
        console.warn("Embedding status fetch failed:", err?.message);
      }
    }
    return sendJSON(res, 200, {
      ...updated,
      embedding: {
        url: embeddingUrl || null,
        status: embeddingStatus,
      },
    });
  } catch (err) {
    return sendJSON(res, 500, {
      error: "Configuration update failed",
      message: err.message,
    });
  }
}

export async function syncEmbeddingHandler(req, res) {
  try {
    await pushEmbeddingConfig({ pushToolset: true, pushSchema: true }).catch(
      () => {}
    );
    const embeddingUrl = (process.env.EMBED_LLM_URL || "").trim();
    let embeddingStatus = null;
    if (embeddingUrl) {
      try {
        embeddingStatus = await getEmbeddingInfo();
      } catch (err) {
        console.warn("Embedding status fetch failed:", err?.message);
      }
    }
    return sendJSON(res, 200, {
      status: "ok",
      embedding: {
        url: embeddingUrl || null,
        status: embeddingStatus,
      },
    });
  } catch (err) {
    return sendJSON(res, 500, {
      error: "Embedding sync failed",
      message: err?.message || "Unknown error",
    });
  }
}
