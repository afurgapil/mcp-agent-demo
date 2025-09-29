import { sendJSON } from "../utils/response.js";
import { getConfig, saveConfig } from "../services/config.service.js";
import { callDeepseekForSql } from "../services/deepseek.service.js";
import { callCustomForSql } from "../services/custom.service.js";
import { callGeminiForSql } from "../services/gemini.service.js";
import {
  tryLoadSchemaSummary,
  getAutoSchemaFromCache,
  updateUsageCsv,
} from "../services/schema.service.js";
import { callTool, listTools } from "../services/mcp.service.js";
import { planToolUsage } from "../services/toolset.service.js";
import { getIsDebugMode } from "./debug.controller.js";
import { logTrainingExample } from "../services/training-log.service.js";

function valueToId(value, seen = new WeakSet()) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (seen.has(value)) return null;
    seen.add(value);

    // If it's a Mongoose ObjectId-like
    if (typeof value.toHexString === "function") {
      try {
        return value.toHexString();
      } catch {}
    }
    if (typeof value.valueOf === "function") {
      const v = value.valueOf();
      if (typeof v === "string") return v;
    }

    // If it has _id, avoid recursing if _id references itself
    if (value._id && value._id !== value) {
      const inner = value._id;
      if (typeof inner === "string") return inner;
      if (typeof inner === "object") {
        if (typeof inner.toHexString === "function") {
          try {
            return inner.toHexString();
          } catch {}
        }
        if (typeof inner.valueOf === "function") {
          const iv = inner.valueOf();
          if (typeof iv === "string") return iv;
        }
      }
    }

    if (typeof value.toString === "function") {
      const str = value.toString();
      return str === "[object Object]" ? null : str;
    }
  }
  return null;
}

function buildRequesterMetadata(req) {
  const user = req?.user;
  if (!user) {
    return null;
  }

  const company = user.company || null;
  const branch = user.branch || null;
  const metadata = {
    id: valueToId(user._id),
    email: user.email || null,
    role: user.role || null,
    companyId: valueToId(company),
    branchId: valueToId(branch),
  };

  if (company && typeof company === "object" && !Array.isArray(company)) {
    metadata.companyName = company.name || null;
  }
  if (branch && typeof branch === "object" && !Array.isArray(branch)) {
    metadata.branchName = branch.name || null;
  }

  return metadata;
}

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
  const requesterMetadata = buildRequesterMetadata(req);
  const {
    prompt,
    schema: customSchema,
    model: requestedModel,
    provider,
  } = body;
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
    planner: null,
    deepseek: null,
    execution: null,
    totalDurationMs: 0,
  };
  const toolsetEnabled =
    typeof body.useToolset === "boolean"
      ? body.useToolset
      : !!config?.toolset?.enabled;
  const toolsetName =
    typeof body.toolsetName === "string" && body.toolsetName.trim()
      ? body.toolsetName.trim()
      : typeof config?.toolset?.name === "string"
      ? config.toolset.name.trim()
      : null;
  const customApiBase =
    config?.providers?.custom?.apiBase || process.env.CUSTOM_API_BASE;

  let executionStrategy = "sql";
  let toolCallInfo = null;
  let plannerSummary = null;
  let plannerDetails = null;

  try {
    const useProvider =
      (typeof provider === "string" && provider.trim()) || "deepseek";
    const modelToUse = (() => {
      if (typeof requestedModel === "string" && requestedModel.trim()) {
        return requestedModel.trim();
      }
      if (useProvider === "gemini") {
        return (
          config?.providers?.gemini?.model || process.env.GEMINI_MODEL || null
        );
      }
      if (useProvider === "custom") {
        return undefined;
      }
      return config.model || undefined;
    })();

    if (toolsetEnabled) {
      try {
        const tools = await listTools();
        const plannerResult = await planToolUsage({
          prompt,
          schema: schemaToUse,
          tools,
          provider: useProvider,
          model: modelToUse,
          toolsetName,
          customApiBase,
        });
        plannerDetails = plannerResult;
        try {
          console.debug(
            "Toolset planner decision",
            JSON.stringify(
              {
                decision: plannerResult.decision,
                reason: plannerResult.reason,
                tool: plannerResult.tool?.name || null,
                tokens: plannerResult.debug?.tokens || null,
                tableHints: plannerResult.debug?.tableHints || null,
              },
              null,
              2
            )
          );
        } catch {}
        const plannerReason = plannerResult.reason || null;
        const plannerToolDefinition = plannerResult.toolDefinition || null;
        plannerSummary = {
          decision: plannerResult.decision,
          reason: plannerReason,
          tool: plannerResult.tool
            ? {
                name: plannerResult.tool.name,
                description:
                  plannerToolDefinition?.description ||
                  plannerToolDefinition?.summary ||
                  null,
              }
            : null,
        };
        debugInfo.planner = {
          request: plannerResult.request,
          response: plannerResult.response,
          rawContent: plannerResult.rawContent,
          parsed: plannerResult.parsed,
          decision: plannerResult.decision,
          reason: plannerReason,
          tool: plannerResult.tool,
          toolDefinition: plannerToolDefinition,
          details: plannerResult.debug,
        };
        if (
          plannerResult.decision === "tool" &&
          plannerResult.tool &&
          typeof plannerResult.tool.name === "string" &&
          plannerResult.tool.name.trim()
        ) {
          const argsCandidate = plannerResult.tool.arguments;
          const toolArgs =
            argsCandidate &&
            typeof argsCandidate === "object" &&
            !Array.isArray(argsCandidate)
              ? argsCandidate
              : {};
          const started = Date.now();
          try {
            const toolResult = await callTool(
              plannerResult.tool.name,
              toolArgs
            );
            const durationMs = Date.now() - started;
            executionStrategy = "tool";
            toolCallInfo = {
              name: plannerResult.tool.name,
              arguments: toolArgs,
              reason: plannerReason,
            };
            debugInfo.execution = {
              durationMs,
              result: toolResult,
              toolName: plannerResult.tool.name,
              arguments: toolArgs,
            };
            debugInfo.totalDurationMs = Date.now() - startTime;

            if (plannerResult.usage) {
              updateUsageCsv({
                promptTokens: plannerResult.usage.prompt_tokens,
                completionTokens: plannerResult.usage.completion_tokens,
                totalTokens: plannerResult.usage.total_tokens,
                schemaSource,
              });
            }

            const responsePayload = {
              prompt,
              sql: null,
              rawModelOutput: plannerResult.rawContent,
              executionResult: toolResult,
              schemaSource,
              usage: plannerResult.usage || undefined,
              provider: useProvider,
              model: modelToUse || undefined,
              strategy: executionStrategy,
              toolCall: toolCallInfo,
              plannerDebug: plannerResult.debug,
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
                planner: debugInfo.planner,
                deepseek: null,
                execution: debugInfo.execution,
              };
            }

            const metadata = {};
            if (plannerResult.debug) {
              metadata.plannerDebug = plannerResult.debug;
            }
            if (toolsetName) {
              metadata.toolsetName = toolsetName;
            }
            if (requesterMetadata) {
              metadata.requester = requesterMetadata;
            }

            await logTrainingExample({
              prompt,
              modelOutput: plannerResult.rawContent,
              sql: null,
              executionResult: toolResult,
              hasError: false,
              provider: useProvider,
              model: modelToUse || null,
              strategy: executionStrategy,
              toolCall: toolCallInfo,
              planner: plannerSummary,
              schemaSource,
              durationMs: debugInfo.totalDurationMs,
              usage: plannerResult.usage || null,
              metadata: Object.keys(metadata).length ? metadata : null,
            });

            return sendJSON(res, 200, responsePayload);
          } catch (toolErr) {
            console.warn(
              `Tool execution via planner failed (${plannerResult.tool.name}): ${toolErr.message}`
            );
            executionStrategy = "sql";
            debugInfo.execution = {
              error: toolErr.message,
              toolName: plannerResult.tool.name,
              arguments: toolArgs,
            };
            toolCallInfo = {
              name: plannerResult.tool.name,
              arguments: toolArgs,
              reason: plannerReason
                ? `${plannerReason} (tool execution failed: ${toolErr.message})`
                : `Tool execution failed: ${toolErr.message}`,
            };
          }
        }
        if (!plannerResult.tool && plannerReason) {
          toolCallInfo = {
            name: undefined,
            arguments: undefined,
            reason: plannerReason,
          };
        }
      } catch (plannerErr) {
        console.warn(
          `Toolset planner failed (falling back to SQL): ${plannerErr.message}`
        );
        debugInfo.planner = {
          error: plannerErr.message,
        };
        plannerSummary = {
          decision: "error",
          reason: plannerErr.message,
          tool: null,
        };
      }
    }
    const llmResponse =
      useProvider === "custom"
        ? await callCustomForSql({
            userPrompt: prompt,
            schema: schemaToUse,
            systemPrompt: config.system_prompt,
            apiBase: customApiBase,
          })
        : useProvider === "gemini"
        ? await callGeminiForSql({
            userPrompt: prompt,
            schema: schemaToUse,
            systemPrompt: config.system_prompt,
            model: modelToUse,
          })
        : await callDeepseekForSql({
            userPrompt: prompt,
            schema: schemaToUse,
            systemPrompt: config.system_prompt,
            model: modelToUse,
          });

    debugInfo.deepseek = {
      request: llmResponse.request,
      response: llmResponse.response,
    };

    const { result: executionResult, durationMs } = await executeSqlThroughMcp(
      llmResponse.sql
    );
    debugInfo.execution = { durationMs, result: executionResult };
    debugInfo.totalDurationMs = Date.now() - startTime;

    const responsePayload = {
      prompt,
      sql: llmResponse.sql,
      rawModelOutput: llmResponse.rawContent,
      executionResult,
      schemaSource,
      usage: llmResponse.usage || undefined,
      provider: useProvider,
      model: modelToUse || undefined,
      strategy: executionStrategy,
      toolCall: toolCallInfo,
      planner: plannerSummary || undefined,
      plannerDebug: plannerSummary ? plannerDetails?.debug : undefined,
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
        planner: debugInfo.planner,
        deepseek: {
          request: debugInfo.deepseek.request,
          response: debugInfo.deepseek.response,
          usage: llmResponse.usage || null,
        },
        execution: debugInfo.execution,
      };
    }

    const metadata = {};
    if (plannerDetails?.debug) {
      metadata.plannerDebug = plannerDetails.debug;
    }
    if (toolsetName) {
      metadata.toolsetName = toolsetName;
    }
    if (requesterMetadata) {
      metadata.requester = requesterMetadata;
    }

    await logTrainingExample({
      prompt,
      modelOutput: llmResponse.rawContent,
      sql: llmResponse.sql,
      executionResult,
      hasError: false,
      provider: useProvider,
      model: modelToUse || null,
      strategy: executionStrategy,
      toolCall: toolCallInfo,
      planner: plannerSummary,
      schemaSource,
      durationMs: debugInfo.totalDurationMs,
      usage: llmResponse.usage || null,
      metadata: Object.keys(metadata).length ? metadata : null,
      requesterUserId: requesterMetadata?.id || null,
      requesterCompanyId: requesterMetadata?.companyId || null,
      requesterBranchId: requesterMetadata?.branchId || null,
      requesterCompanyName: requesterMetadata?.companyName || null,
      requesterBranchName: requesterMetadata?.branchName || null,
    });

    if (llmResponse.usage) {
      updateUsageCsv({
        promptTokens: llmResponse.usage.prompt_tokens,
        completionTokens: llmResponse.usage.completion_tokens,
        totalTokens: llmResponse.usage.total_tokens,
        schemaSource,
      });
    }

    return sendJSON(res, 200, responsePayload);
  } catch (err) {
    console.error("Generation pipeline failed:", err.message);
    const duration = Date.now() - startTime;
    debugInfo.totalDurationMs = duration;
    const errorMetadata = {};
    if (plannerDetails?.debug) {
      errorMetadata.plannerDebug = plannerDetails.debug;
    }
    if (toolsetName) {
      errorMetadata.toolsetName = toolsetName;
    }
    if (err?.stack) {
      errorMetadata.stack = err.stack;
    }
    if (requesterMetadata) {
      errorMetadata.requester = requesterMetadata;
    }

    await logTrainingExample({
      prompt,
      modelOutput: debugInfo.deepseek?.response || null,
      sql: null,
      executionResult: debugInfo.execution?.result || null,
      hasError: true,
      errorMessage: err.message,
      provider: provider || null,
      model: requestedModel || null,
      strategy: executionStrategy,
      toolCall: toolCallInfo,
      planner: plannerSummary,
      schemaSource,
      durationMs: debugInfo.totalDurationMs,
      usage: null,
      metadata: Object.keys(errorMetadata).length ? errorMetadata : null,
    });
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
          planner: debugInfo.planner,
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
