import { callDeepseekChat } from "./deepseek.service.js";
import { callGeminiChat } from "./gemini.service.js";
import { callCustomChat } from "./custom.service.js";
import { rankToolsWithEmbedding } from "./embedding.service.js";
import { searchEntities as retrievalSearchEntities } from "./retrieval.service.js";

function summarizeSchema(schema, limit = 4000) {
  if (!schema || typeof schema !== "string") return "(schema not provided)";
  const trimmed = schema.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}\n...[truncated]`;
}

function formatTool(tool) {
  const parts = [];
  parts.push(`- ${tool.name}`);
  if (tool.description) {
    parts.push(`  description: ${String(tool.description)}`);
  }
  const schema =
    tool.inputSchema || tool.input_schema || tool.parameters || tool.args;
  if (schema && typeof schema === "object") {
    try {
      const clean = JSON.parse(JSON.stringify(schema));
      parts.push(`  arguments: ${JSON.stringify(clean)}`);
    } catch {
      parts.push(`  arguments: ${JSON.stringify(schema)}`);
    }
  } else {
    parts.push("  arguments: none");
  }
  return parts.join("\n");
}

function describeToolForDebug(tool) {
  if (!tool || typeof tool !== "object") return null;
  const schema =
    tool.inputSchema ||
    tool.input_schema ||
    tool.parameters ||
    tool.args ||
    null;
  const clone = {
    name: tool.name,
    description: tool.description || null,
  };
  if (schema && typeof schema === "object") {
    clone.inputSchema = schema;
  }
  if (tool.embeddingScore != null) {
    clone.embeddingScore = tool.embeddingScore;
  }
  if (tool.argumentSuggestions) {
    clone.argumentSuggestions = tool.argumentSuggestions;
  }
  return clone;
}

function parseSchemaTables(schemaText) {
  if (!schemaText || typeof schemaText !== "string") return [];
  try {
    const parsed = JSON.parse(schemaText);
    if (!Array.isArray(parsed?.tables)) return [];
    const seen = new Set();
    const result = [];
    for (const table of parsed.tables) {
      if (!table || typeof table.name !== "string") continue;
      const name = table.name.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      result.push(name);
    }
    return result;
  } catch {
    return [];
  }
}

function selectPrimaryTable(tableHints, tableNames) {
  if (Array.isArray(tableHints)) {
    const match = tableHints.find(
      (name) => typeof name === "string" && name.trim()
    );
    if (match) return match.trim();
  }
  if (Array.isArray(tableNames)) {
    const match = tableNames.find(
      (name) => typeof name === "string" && name.trim()
    );
    if (match) return match.trim();
  }
  return null;
}

function applyArgumentDefaults(tool, tableHints, tableNames, suggestions) {
  if (!tool || typeof tool !== "object") return tool;
  const args =
    tool.arguments && typeof tool.arguments === "object"
      ? { ...tool.arguments }
      : {};

  if (suggestions && typeof suggestions === "object") {
    for (const [key, value] of Object.entries(suggestions)) {
      if (value !== undefined && value !== null && args[key] === undefined) {
        args[key] = value;
      }
    }
  }

  const primaryTable = selectPrimaryTable(tableHints, tableNames);
  const toolName = (tool.name || "").toLowerCase();

  if (primaryTable && toolName.includes("table")) {
    if (!args.tableName) args.tableName = primaryTable;
    if (!args.table) args.table = primaryTable;
    if (!args.table_name) args.table_name = primaryTable;
  }

  if (toolName.includes("list") || toolName.includes("select")) {
    if (typeof args.limit !== "number") args.limit = 50;
    if (typeof args.offset !== "number" && typeof args.start !== "number") {
      args.offset = 0;
    }
  }

  tool.arguments = args;
  return tool;
}

function extractJson(text) {
  if (!text || typeof text !== "string") return null;
  const direct = text.trim();
  try {
    return JSON.parse(direct);
  } catch {}
  const firstBrace = direct.indexOf("{");
  const lastBrace = direct.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = direct.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function buildPlannerSystemPrompt() {
  return `You are a routing planner for a SQL assistant that can either call predefined MCP tools or let the assistant generate raw SQL.\n\nDecide the best approach for the given request.\n- Prefer calling a tool when one can fully satisfy the request using its capabilities.\n- Only choose a tool if the description and parameters align with the request.\n- If no tool is suitable, respond with a decision of \"sql\".\n- When choosing \"sql\", do not propose a tool fallback.\n- Never invent tools or arguments.\n- Always include every required argument the tool expects.\n- If the user omits numeric parameters such as limit or offset, default to limit=50 and offset=0.\n- If a tool needs a table name, infer the closest match from the provided schema.\n- Respond only with raw JSON matching the schema below (no markdown, code fences, or explanations).\n\nRespond with a single JSON object matching this schema (no extra text):\n{\n  \"decision\": \"tool\" | \"sql\",\n  \"reason\": string,\n  \"tool\": {\n    \"name\": string,\n    \"arguments\": object\n  } | null\n}\nIf decision is \"sql\", set \"tool\" to null.`;
}

function buildPlannerUserPrompt({
  prompt,
  schema,
  tools,
  toolsetName,
  tableHints,
  filterHints,
}) {
  const header = toolsetName
    ? `Available tools in toolset \"${toolsetName}\":`
    : "Available tools:";
  const toolSummaries = tools.map(formatTool).join("\n\n");
  const tableLine =
    Array.isArray(tableHints) && tableHints.length > 0
      ? `Likely relevant tables: ${tableHints.join(", ")}.`
      : "";
  const filterLine =
    Array.isArray(filterHints) && filterHints.length > 0
      ? `Likely entity filters: ${filterHints
          .map((e) => (e.type ? `${e.type}=${e.text}` : e.text))
          .join(", ")}.`
      : "";
  return `User request:\n${prompt.trim()}\n\n${header}\n${toolSummaries}\n\n${tableLine}\n${filterLine}\nSchema summary (may be truncated):\n${summarizeSchema(
    schema
  )}`;
}

export async function planToolUsage({
  prompt,
  schema,
  tools,
  provider,
  model,
  toolsetName,
  customApiBase,
}) {
  const availableTools = Array.isArray(tools) ? tools : [];
  const filtered = availableTools.filter((tool) => {
    if (!tool || typeof tool.name !== "string") return false;
    const name = tool.name.toLowerCase();
    return name !== "postgres_execute_sql"; // exclude raw execution tool from planner ranking
  });

  if (filtered.length === 0) {
    return {
      decision: "sql",
      reason: "No eligible tools",
      tool: null,
      rawContent: null,
      response: null,
      request: null,
      usage: null,
      parsed: null,
      toolDefinition: null,
      debug: {
        embedding: null,
        tableNames: [],
        tableHints: [],
        filteredTools: [],
        plannerTools: [],
        finalTool: null,
      },
    };
  }

  const filteredMap = new Map(filtered.map((tool) => [tool.name, tool]));

  const embeddingRanking = await rankToolsWithEmbedding({
    prompt,
    limit: 8,
    schema,
    systemPrompt: buildPlannerSystemPrompt(),
  });

  const embeddingTools = Array.isArray(embeddingRanking?.tools)
    ? embeddingRanking.tools
    : [];
  const embeddingTableHints = Array.isArray(embeddingRanking?.tableHints)
    ? embeddingRanking.tableHints
        .map((hint) =>
          typeof hint?.name === "string" && hint.name.trim()
            ? hint.name.trim()
            : null
        )
        .filter(Boolean)
    : [];

  const tableNames = parseSchemaTables(schema);
  const tableHints = embeddingTableHints.length
    ? embeddingTableHints
    : tableNames.slice(0, 3);

  // Retrieve entity-level hints via retrieval service (RAG Phase 3)
  let filterHints = [];
  try {
    const entityResp = await retrievalSearchEntities({
      query: prompt,
      types: null,
      limit: 10,
    });
    if (entityResp && Array.isArray(entityResp.results)) {
      filterHints = entityResp.results.map((r) => ({
        id: r.id,
        type: r.type,
        text: r.text,
        score: r.score,
        metadata: r.metadata || null,
      }));
    }
  } catch (err) {
    // best-effort only
    filterHints = [];
  }

  const plannerTools = embeddingTools.length
    ? embeddingTools
        .map((item) => {
          const base = filteredMap.get(item.name);
          if (base) {
            return {
              ...base,
              description: item.description ?? base.description,
              inputSchema: item.inputSchema ?? base.inputSchema,
              argumentSuggestions: item.argumentSuggestions || null,
              embeddingScore: item.score ?? null,
            };
          }
          return {
            name: item.name,
            description: item.description || "",
            inputSchema: item.inputSchema || null,
            argumentSuggestions: item.argumentSuggestions || null,
            embeddingScore: item.score ?? null,
          };
        })
        .filter((tool) => typeof tool.name === "string" && tool.name)
    : filtered.slice(0, 8).map((tool) => ({ ...tool }));

  const systemPrompt = buildPlannerSystemPrompt();
  const userPrompt = buildPlannerUserPrompt({
    prompt,
    schema,
    tools: plannerTools,
    toolsetName,
    tableHints,
    filterHints: filterHints.slice(0, 5),
  });

  let chatResult;
  if (provider === "gemini") {
    chatResult = await callGeminiChat({
      systemPrompt,
      userPrompt,
      model,
    });
  } else if (provider === "custom") {
    chatResult = await callCustomChat({
      systemPrompt,
      userPrompt,
      apiBase: customApiBase,
    });
  } else {
    chatResult = await callDeepseekChat({
      systemPrompt,
      userPrompt,
      model,
    });
  }

  const { content, response, request, usage } = chatResult;
  const parsed = extractJson(content);
  let decision = "sql";
  let reason = null;
  let tool = null;
  let suggestionsForTool = null;

  if (parsed && typeof parsed === "object") {
    if (parsed.decision === "tool" && parsed.tool) {
      let plannerTool = parsed.tool;
      if (typeof plannerTool === "string") {
        try {
          plannerTool = JSON.parse(plannerTool);
        } catch {}
      }
      if (
        plannerTool &&
        typeof plannerTool === "object" &&
        typeof plannerTool.name === "string"
      ) {
        if (
          plannerTool.arguments &&
          typeof plannerTool.arguments === "string" &&
          plannerTool.arguments.trim()
        ) {
          try {
            plannerTool.arguments = JSON.parse(plannerTool.arguments);
          } catch {}
        }
        suggestionsForTool = plannerTools.find(
          (entry) => entry?.name === plannerTool.name
        )?.argumentSuggestions;
        tool = applyArgumentDefaults(
          {
            name: plannerTool.name,
            arguments:
              plannerTool.arguments &&
              typeof plannerTool.arguments === "object" &&
              !Array.isArray(plannerTool.arguments)
                ? plannerTool.arguments
                : {},
          },
          tableHints,
          tableNames,
          suggestionsForTool
        );
        decision = "tool";
      }
    }
    if (typeof parsed.reason === "string") {
      reason = parsed.reason;
    }
  }

  if (decision === "sql" && !reason) {
    reason = "Planner did not find a confident tool match for the request";
  }

  return {
    decision,
    reason,
    tool,
    rawContent: content,
    response,
    request,
    usage,
    parsed,
    toolDefinition:
      decision === "tool"
        ? plannerTools.find((entry) => entry.name === tool?.name) || null
        : null,
    debug: {
      embedding: embeddingRanking || null,
      tableNames,
      tableHints,
      filterHints,
      filteredTools: filtered.map((entry) => entry.name),
      plannerTools: plannerTools.map(describeToolForDebug),
      finalTool:
        decision === "tool" && tool
          ? { name: tool.name, arguments: tool.arguments }
          : null,
    },
  };
}
