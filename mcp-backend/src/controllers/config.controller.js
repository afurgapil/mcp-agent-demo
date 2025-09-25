import { sendJSON } from "../utils/response.js";
import { getConfig, saveConfig } from "../services/config.service.js";

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
      return sendJSON(res, 200, data);
    } catch (err) {
      return sendJSON(res, 500, {
        error: "Custom config fetch failed",
        message: err?.message,
      });
    }
  }
  return sendJSON(res, 200, config);
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
  const maskSensitive = (obj) => {
    try {
      const clone = JSON.parse(JSON.stringify(obj || {}));
      const keyPath = clone?.providers?.deepseek?.apiKey;
      if (typeof keyPath === "string" && keyPath) {
        clone.providers.deepseek.apiKey = keyPath.slice(0, 4) + "****";
      }
      return clone;
    } catch {
      return {};
    }
  };
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
      return sendJSON(res, 200, data);
    } catch (err) {
      return sendJSON(res, 500, {
        error: "Custom config update failed",
        message: err?.message,
      });
    }
  }
  try {
    const updated = saveConfig(req.body || {});
    return sendJSON(res, 200, updated);
  } catch (err) {
    return sendJSON(res, 500, {
      error: "Configuration update failed",
      message: err.message,
    });
  }
}
