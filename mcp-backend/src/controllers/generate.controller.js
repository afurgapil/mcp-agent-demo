import { sendJSON } from "../utils/response.js";
import { getConfig, saveConfig } from "../services/config.service.js";
import { callDeepseekForSql } from "../services/deepseek.service.js";
import {
  tryLoadSchemaSummary,
  getAutoSchemaFromCache,
  updateUsageCsv,
} from "../services/schema.service.js";
import { callTool } from "../services/mcp.service.js";
import { getIsDebugMode } from "./debug.controller.js";

async function executeSqlThroughMcp(sql) {
  const startedAt = Date.now();
  const result = await callTool("mysql_execute_sql", { sql });
  const durationMs = Date.now() - startedAt;
  return { result, durationMs };
}

export async function reloadSchema(req, res) {
  const fileSchema = tryLoadSchemaSummary();
  if (!fileSchema) {
    return sendJSON(res, 404, {
      error: "schema.summary.json not found or empty",
    });
  }
  const updated = saveConfig({ schema: fileSchema });
  return sendJSON(res, 200, {
    message: "Schema reloaded from file",
    length: fileSchema.length,
    config: { schemaLength: (updated.schema || "").length },
  });
}

export async function generateHandler(req, res) {
  const body = req.body || {};
  const { prompt, schema: customSchema } = body;
  if (!prompt || typeof prompt !== "string") {
    return sendJSON(res, 422, {
      detail: [
        {
          loc: ["body", "prompt"],
          msg: "field required",
          type: "value_error.missing",
        },
      ],
    });
  }

  const config = getConfig();
  let schemaToUse = "";
  let schemaSource = "none";

  if (typeof customSchema === "string" && customSchema.trim()) {
    schemaToUse = customSchema.trim();
    schemaSource = "custom";
  } else if (typeof config.schema === "string" && config.schema.trim()) {
    schemaToUse = config.schema.trim();
    schemaSource = "config";
  } else {
    const fileSchema = tryLoadSchemaSummary();
    if (fileSchema) {
      schemaToUse = fileSchema;
      schemaSource = "file";
    } else {
      const autoSchema = await getAutoSchemaFromCache();
      if (autoSchema.schema && autoSchema.schema.trim()) {
        schemaToUse = autoSchema.schema.trim();
        schemaSource = autoSchema.source || "fetched";
        if (schemaSource === "fetched") {
          try {
            saveConfig({ schema: schemaToUse });
          } catch (persistErr) {
            console.warn(
              `Failed to persist fetched schema: ${persistErr.message}`
            );
          }
        }
      }
    }
  }

  const startTime = Date.now();
  const debugInfo = {
    schema: { source: schemaSource, length: schemaToUse.length },
    deepseek: null,
    execution: null,
    totalDurationMs: 0,
  };

  try {
    const deepseekResponse = await callDeepseekForSql({
      userPrompt: prompt,
      schema: schemaToUse,
      systemPrompt: config.system_prompt,
    });

    debugInfo.deepseek = {
      request: deepseekResponse.request,
      response: deepseekResponse.response,
    };

    const { result: executionResult, durationMs } = await executeSqlThroughMcp(
      deepseekResponse.sql
    );
    debugInfo.execution = { durationMs, result: executionResult };
    debugInfo.totalDurationMs = Date.now() - startTime;

    const responsePayload = {
      prompt,
      sql: deepseekResponse.sql,
      rawModelOutput: deepseekResponse.rawContent,
      executionResult,
      schemaSource,
      usage: deepseekResponse.usage || undefined,
    };

    if (getIsDebugMode()) {
      responsePayload.debug = {
        mode: "enabled",
        totalDurationMs: debugInfo.totalDurationMs,
        schema: {
          source: schemaSource,
          length: schemaToUse.length,
          snippet: schemaToUse.slice(0, 2000),
        },
        deepseek: {
          request: debugInfo.deepseek.request,
          response: debugInfo.deepseek.response,
          usage: deepseekResponse.usage || null,
        },
        execution: debugInfo.execution,
      };
    }

    if (deepseekResponse.usage) {
      updateUsageCsv({
        promptTokens: deepseekResponse.usage.prompt_tokens,
        completionTokens: deepseekResponse.usage.completion_tokens,
        totalTokens: deepseekResponse.usage.total_tokens,
        schemaSource,
      });
    }

    return sendJSON(res, 200, responsePayload);
  } catch (err) {
    console.error("Generation pipeline failed:", err.message);
    const duration = Date.now() - startTime;
    debugInfo.totalDurationMs = duration;
    if (getIsDebugMode()) {
      return sendJSON(res, 500, {
        error: "Pipeline failed",
        message: err.message,
        debug: {
          mode: "enabled",
          totalDurationMs: duration,
          schema: {
            source: schemaSource,
            length: schemaToUse.length,
            snippet: schemaToUse.slice(0, 2000),
          },
          deepseek: debugInfo.deepseek,
          execution: debugInfo.execution,
        },
      });
    }
    return sendJSON(res, 500, {
      error: "Pipeline failed",
      message: err.message,
    });
  }
}
