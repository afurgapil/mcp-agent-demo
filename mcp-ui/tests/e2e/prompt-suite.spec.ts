import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";

type ValidatorType = "contains" | "icontains" | "regex" | "not_contains";

interface PromptValidator {
  type: ValidatorType;
  value: string;
}

interface PromptCase {
  prompt: string;
  expectedSql?: string;
  validators?: PromptValidator[];
  metadata?: Record<string, unknown>;
}

interface PromptResult {
  prompt: string;
  outcome: "sql" | "tool" | "error" | "timeout";
  success: boolean;
  scored: boolean;
  latencyMs: number;
  response?: string | null;
  errorMessage?: string | null;
  reasons: string[];
  metadata: Record<string, unknown>;
}

const DEFAULT_DATASET = path.join(__dirname, "prompts.json");
// Disable prompt timeout to allow unlimited wait for AI response
const promptTimeoutMs = 0;
const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001"
).replace(/\/$/, "");
const LOGIN_EMAIL = process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@barfas.com";
const LOGIN_PASSWORD = process.env.PLAYWRIGHT_LOGIN_PASSWORD || "Admin123!";

async function loginAndSeedToken(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext
) {
  const res = await request.post(`${API_BASE}/auth/login`, {
    headers: { "Content-Type": "application/json" },
    data: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`Login failed with status ${res.status()}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data?.token) throw new Error("Login succeeded but no token returned");
  const token = data.token;
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("mcp_ui_token", t);
    } catch {}
  }, token);
}
const promptDelayMs = Number(process.env.PLAYWRIGHT_PROMPT_DELAY ?? "0");
const minSuccessEnv = process.env.PLAYWRIGHT_MIN_SUCCESS_RATE;
const minSuccessRate = minSuccessEnv ? clamp01(Number(minSuccessEnv)) : 1;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function loadDataset(): PromptCase[] {
  const datasetPath = process.env.PLAYWRIGHT_PROMPTS
    ? path.resolve(process.cwd(), process.env.PLAYWRIGHT_PROMPTS)
    : DEFAULT_DATASET;

  if (!fs.existsSync(datasetPath)) {
    throw new Error(
      `Prompt dataset not found. Expected file at ${datasetPath}. ` +
        "Set PLAYWRIGHT_PROMPTS to point at your dataset."
    );
  }

  const rawText = fs.readFileSync(datasetPath, "utf8");

  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      return normalizeEntries(parsed);
    }
    if (Array.isArray((parsed as { prompts?: unknown }).prompts)) {
      return normalizeEntries((parsed as { prompts: unknown[] }).prompts);
    }
    throw new Error("Dataset JSON must be an array or { prompts: [] }");
  } catch (jsonErr) {
    const lines = rawText
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      throw jsonErr;
    }
    return lines.map((line) => ({ prompt: line }));
  }
}

function normalizeEntries(entries: unknown[]): PromptCase[] {
  const result: PromptCase[] = [];
  entries.forEach((entry, index) => {
    if (typeof entry === "string") {
      const prompt = entry.trim();
      if (prompt) {
        result.push({ prompt });
      }
      return;
    }
    if (!entry || typeof entry !== "object") {
      throw new Error(`Dataset entry #${index + 1} must be a string or object`);
    }
    const candidate = entry as Record<string, unknown>;
    const prompt =
      (typeof candidate.prompt === "string" && candidate.prompt.trim()) ||
      (typeof candidate.message === "string" && candidate.message.trim()) ||
      (typeof candidate.input === "string" && candidate.input.trim());
    if (!prompt) {
      throw new Error(`Dataset entry #${index + 1} missing 'prompt'`);
    }
    const normalized: PromptCase = {
      prompt,
      metadata: {},
    };
    if (typeof candidate.expected_sql === "string") {
      normalized.expectedSql = candidate.expected_sql;
    } else if (typeof candidate.expected === "string") {
      normalized.expectedSql = candidate.expected;
    }
    if (Array.isArray(candidate.validators)) {
      normalized.validators = candidate.validators
        .filter((value): value is PromptValidator => isValidator(value))
        .map((value) => ({ type: value.type, value: String(value.value) }));
    }
    normalized.metadata = Object.fromEntries(
      Object.entries(candidate).filter(
        ([key]) =>
          ![
            "prompt",
            "message",
            "input",
            "expected_sql",
            "expected",
            "validators",
          ].includes(key)
      )
    );
    result.push(normalized);
  });
  if (!result.length) {
    throw new Error("Dataset contains no prompts");
  }
  return result;
}

function isValidator(value: unknown): value is PromptValidator {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.type === "string" &&
    ["contains", "icontains", "regex", "not_contains"].includes(record.type) &&
    record.value !== undefined
  );
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/--.*?$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;$/, "")
    .toLowerCase();
}

function runValidators(text: string, validators: PromptValidator[]): string[] {
  const failures: string[] = [];
  validators.forEach((validator) => {
    const value = String(validator.value);
    if (validator.type === "contains") {
      if (!text.includes(value)) {
        failures.push(`missing substring '${value}'`);
      }
      return;
    }
    if (validator.type === "icontains") {
      if (!text.toLowerCase().includes(value.toLowerCase())) {
        failures.push(`missing icontains '${value}'`);
      }
      return;
    }
    if (validator.type === "not_contains") {
      if (text.includes(value)) {
        failures.push(`forbidden substring '${value}' present`);
      }
      return;
    }
    if (validator.type === "regex") {
      const regex = new RegExp(value);
      if (!regex.test(text)) {
        failures.push(`regex '${value}' not matched`);
      }
    }
  });
  return failures;
}

function evaluateResponse(
  record: PromptCase,
  response: string | null
): {
  success: boolean;
  scored: boolean;
  reasons: string[];
} {
  if (!response || !response.trim()) {
    return {
      success: false,
      scored: Boolean(record.expectedSql || record.validators?.length),
      reasons: ["empty response"],
    };
  }

  const reasons: string[] = [];
  let success = true;
  const scored = Boolean(record.expectedSql || record.validators?.length);

  if (record.expectedSql) {
    const expected = normalizeSql(record.expectedSql);
    const actual = normalizeSql(response);
    if (expected !== actual) {
      success = false;
      reasons.push("normalized SQL mismatch");
    }
  }

  if (record.validators?.length) {
    const validatorFailures = runValidators(response, record.validators);
    if (validatorFailures.length) {
      success = false;
      reasons.push(...validatorFailures);
    }
  }

  return { success, scored, reasons };
}

test("runs prompt regression suite via UI", async ({
  page,
  request,
}, testInfo) => {
  let dataset: PromptCase[] | undefined;
  try {
    dataset = loadDataset();
  } catch (err) {
    const reason = typeof err === "string" ? err : (err as Error).message;
    test.skip(true, reason);
    return;
  }

  const results: PromptResult[] = [];

  for (const [index, record] of (dataset ?? []).entries()) {
    await test.step(`Prompt #${index + 1}`, async () => {
      const started = Date.now();
      // Ensure the app sees an authenticated session before any navigation
      await loginAndSeedToken(page, request);
      await page.goto("/");

      const modelSelect = page.getByTestId("model-select");
      await modelSelect.selectOption("custom");
      await expect(modelSelect).toHaveValue("custom");

      const input = page.getByTestId("prompt-input");
      await input.fill(record.prompt);

      const submit = page.getByTestId("submit-button");
      await expect(submit).toBeEnabled();
      await submit.click();

      const outcomeHandle = await page
        .waitForFunction(
          () => {
            const errorEl = document.querySelector(
              '[data-testid="query-error"]'
            );
            if (errorEl) {
              return {
                type: "error" as const,
                message: errorEl.textContent || "Error",
              };
            }
            const sqlEl = document.querySelector(
              '[data-testid="generated-sql"]'
            );
            if (sqlEl && sqlEl.textContent && sqlEl.textContent.trim().length) {
              return {
                type: "sql" as const,
                sql: sqlEl.textContent,
              };
            }
            // Detect tool-based result card by its title text
            const toolHeader = Array.from(document.querySelectorAll("h2")).find(
              (el) => /\bTool Result\b/i.test(el.textContent || "")
            );
            if (toolHeader) {
              return { type: "tool" as const };
            }
            return null;
          },
          // When timeout is 0, Playwright waits indefinitely
          { timeout: promptTimeoutMs }
        )
        .catch(() => null);

      type OutcomeValue =
        | { type: "error"; message: string }
        | { type: "sql"; sql: string }
        | { type: "tool" }
        | null;

      const outcome: OutcomeValue = outcomeHandle
        ? ((await outcomeHandle.jsonValue()) as OutcomeValue)
        : null;

      await expect(submit)
        .toBeEnabled({ timeout: 0 })
        .catch(() => {
          /* ignore */
        });

      const latencyMs = Date.now() - started;

      // With infinite wait, we should always have an outcome; if not, treat as error
      if (!outcome) {
        results.push({
          prompt: record.prompt,
          outcome: "error",
          success: false,
          scored: Boolean(record.expectedSql || record.validators?.length),
          latencyMs,
          response: null,
          errorMessage: "No outcome detected",
          reasons: ["no outcome"],
          metadata: record.metadata ?? {},
        });
        return;
      }

      if (outcome && "type" in outcome && outcome.type === "error") {
        results.push({
          prompt: record.prompt,
          outcome: "error",
          success: false,
          scored: Boolean(record.expectedSql || record.validators?.length),
          latencyMs,
          response: null,
          errorMessage: (outcome as { type: "error"; message: string }).message,
          reasons: ["backend error"],
          metadata: record.metadata ?? {},
        });
        return;
      }

      if (outcome && "type" in outcome && outcome.type === "tool") {
        // Treat tool-based outcomes as successful results when no strict scoring is defined
        const scored = Boolean(record.expectedSql || record.validators?.length);
        results.push({
          prompt: record.prompt,
          outcome: "tool",
          success: !scored, // if there is no scoring, count as success
          scored,
          latencyMs,
          response: null,
          errorMessage: null,
          reasons: [],
          metadata: record.metadata ?? {},
        });
        return;
      }

      const responseText = (outcome as { type: "sql"; sql: string }).sql ?? "";
      const evaluation = evaluateResponse(record, responseText);
      results.push({
        prompt: record.prompt,
        outcome: "sql",
        success: evaluation.success,
        scored: evaluation.scored,
        latencyMs,
        response: responseText,
        errorMessage: null,
        reasons: evaluation.reasons,
        metadata: record.metadata ?? {},
      });
    });

    if (promptDelayMs > 0) {
      await page.waitForTimeout(promptDelayMs);
    }
  }

  const scored = results.filter((item) => item.scored);
  const scoredSuccess = scored.filter((item) => item.success).length;
  const scoredFailures = scored.filter((item) => !item.success);
  const totalSuccess = results.filter((item) => item.success).length;
  const hardFailures = results.filter((item) => item.outcome === "error");
  const latencyValues = results.map((item) => item.latencyMs);

  const scoredSuccessRate = scored.length
    ? scoredSuccess / scored.length
    : undefined;
  const summary = {
    totalPrompts: results.length,
    scoredPrompts: scored.length,
    scoredSuccesses: scoredSuccess,
    scoredFailures: scoredFailures.length,
    scoredSuccessRate,
    overallSuccesses: totalSuccess,
    errorCount: hardFailures.length,
    latencyAvgMs: average(latencyValues),
    latencyP95Ms: percentile(latencyValues, 95),
    latencyMaxMs: latencyValues.length ? Math.max(...latencyValues) : undefined,
  };

  console.log("\nPrompt Evaluation Summary");
  console.log(`Total prompts: ${summary.totalPrompts}`);
  console.log(`Scored prompts: ${summary.scoredPrompts}`);
  console.log(
    `Scored success rate: ${
      summary.scoredSuccessRate !== undefined
        ? (summary.scoredSuccessRate * 100).toFixed(2) + "%"
        : "n/a"
    }`
  );
  console.log(`Overall successes: ${summary.overallSuccesses}`);
  console.log(`Errors/timeouts: ${summary.errorCount}`);
  console.log(
    `Latency avg (ms): ${
      summary.latencyAvgMs !== undefined
        ? summary.latencyAvgMs.toFixed(1)
        : "n/a"
    }`
  );
  console.log(
    `Latency p95 (ms): ${
      summary.latencyP95Ms !== undefined
        ? summary.latencyP95Ms.toFixed(1)
        : "n/a"
    }`
  );
  console.log(
    `Latency max (ms): ${
      summary.latencyMaxMs !== undefined
        ? summary.latencyMaxMs.toFixed(1)
        : "n/a"
    }`
  );

  await testInfo.attach("prompt-results.json", {
    body: Buffer.from(JSON.stringify({ summary, results }, null, 2), "utf8"),
    contentType: "application/json",
  });

  if (hardFailures.length) {
    const messages = hardFailures.map((item) => {
      if (item.outcome === "error") {
        return `${item.prompt} → backend error: ${
          item.errorMessage ?? "unknown"
        }`;
      }
      return `${item.prompt} → unexpected outcome`;
    });
    expect.soft(messages, "All prompts should return a result").toHaveLength(0);
  }

  if (scoredFailures.length) {
    const messages = scoredFailures.map(
      (item) => `${item.prompt} → ${item.reasons.join(", ") || "failed"}`
    );
    expect.soft(messages, "All scored prompts should succeed").toHaveLength(0);
  }

  if (summary.scoredSuccessRate !== undefined) {
    expect(summary.scoredSuccessRate).toBeGreaterThanOrEqual(minSuccessRate);
  }
});

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], pct: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (pct / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.min(sorted.length - 1, lower + 1);
  const weight = rank - lower;
  if (upper === lower) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}
