import { extractSqlFromText } from "./sql-extractor.js";

function buildUserMessage(userPrompt) {
  return userPrompt.trim();
}

function getTimeoutMs() {
  const fromEnv = Number(process.env.CUSTOM_API_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 10000; // 10s default
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Request timed out")),
    timeoutMs
  );
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

async function fetchJsonWithTimeout(url, options = {}) {
  const timeoutMs = getTimeoutMs();
  const { signal, clear } = createTimeoutSignal(timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
      signal,
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      // non-JSON or empty body; keep data as {}
    }
    return { res, data };
  } catch (err) {
    // Surface low-level network error details
    const cause = err?.cause || err;
    const code = cause?.code || cause?.name || "UNKNOWN";
    const msg = cause?.message || String(err);
    const enriched = new Error(`fetch failed: ${code}: ${msg}`, { cause: err });
    throw enriched;
  } finally {
    clear();
  }
}

function resolveApiBase(apiBase) {
  let base = (apiBase || process.env.CUSTOM_API_BASE || "").trim();

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

  let res, data;
  try {
    ({ res, data } = await fetchJsonWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  } catch (err) {
    // Add endpoint context to error
    throw new Error(`Network error calling ${endpoint}: ${err.message}`, {
      cause: err,
    });
  }
  if (!res.ok) {
    const msg =
      data?.detail?.[0]?.msg ||
      data?.message ||
      res.statusText ||
      "Unknown upstream error";
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
    schema: typeof schema === "string" ? schema : JSON.stringify(schema || ""),
    system_prompt: systemPrompt,
  };

  const res = await fetch(new URL("/api/generate", base).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // The above existing fetch will be replaced with the timeout-enabled helper
  // to keep indentation context stable in this patch section.
  // Re-run request with timeout/error enrichment:
  let timedRes, data;
  try {
    ({ res: timedRes, data } = await fetchJsonWithTimeout(
      new URL("/api/generate", base).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    ));
  } catch (err) {
    throw new Error(
      `Network error calling ${new URL("/api/generate", base).toString()}: ${
        err.message
      }`,
      { cause: err }
    );
  }
  if (!timedRes.ok) {
    const msg =
      data?.detail?.[0]?.msg ||
      data?.message ||
      timedRes.statusText ||
      "Unknown upstream error";
    throw new Error(`Custom API error ${timedRes.status}: ${msg}`);
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
