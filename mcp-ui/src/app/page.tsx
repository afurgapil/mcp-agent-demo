"use client";

import { useMemo, useState, useEffect } from "react";
import { extractRows, schemaSourceLabel } from "../utils/format";
import { DataTable } from "../components";
import {
  getDebugStatus,
  toggleDebug as apiToggleDebug,
  fetchConfig as apiFetchConfig,
  updateConfig as apiUpdateConfig,
  fetchTools as apiFetchTools,
  callTool as apiCallTool,
  generate as apiGenerate,
} from "../services/api";
const MODEL_STORAGE_KEY = "mcp_ui_model";

// Debug panel types
type DebugPayload = {
  mode?: string;
  totalDurationMs?: number;
  deepseek?: {
    request?: unknown;
    response?: unknown;
  };
  execution?: {
    durationMs?: number;
    result?: unknown;
  };
  schema?: {
    source?: string;
    length?: number;
    snippet?: string;
  };
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [customSchema, setCustomSchema] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [generatedSql, setGeneratedSql] = useState<string | null>(null);
  const [modelOutput, setModelOutput] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<unknown>(null);
  const [schemaSource, setSchemaSource] = useState<string | null>(null);
  const hasResults = useMemo(
    () => !!generatedSql || executionResult != null,
    [generatedSql, executionResult]
  );

  // Debug panel state
  const [debugMode, setDebugMode] = useState(true);
  const [debugData, setDebugData] = useState<DebugPayload | null>(null);
  const [model, setModel] = useState<string>(() => {
    try {
      if (typeof window !== "undefined") {
        return localStorage.getItem(MODEL_STORAGE_KEY) || "";
      }
    } catch {}
    return "";
  });
  const provider = useMemo(() => {
    if (model === "custom") return "custom";
    if (model?.startsWith("gemini")) return "gemini";
    return "deepseek";
  }, [model]);

  // Check debug mode status on mount
  useEffect(() => {
    getDebugStatus()
      .then((d) => setDebugMode(!!d.debugMode))
      .catch(() => {});
    try {
      const savedModel =
        typeof window !== "undefined"
          ? localStorage.getItem(MODEL_STORAGE_KEY)
          : null;
      if (savedModel) setModel(savedModel);
    } catch {}
  }, []);

  // Persist model selection locally
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (model) {
        localStorage.setItem(MODEL_STORAGE_KEY, model);
      } else {
        localStorage.removeItem(MODEL_STORAGE_KEY);
      }
    } catch {}
  }, [model]);

  // Toggle debug mode on backend
  const toggleDebugMode = async () => {
    try {
      const data = await apiToggleDebug();
      setDebugMode(!!data.debugMode);
    } catch (err) {
      console.error("Failed to toggle debug mode:", err);
    }
  };

  // Configuration state
  const [activeTab, setActiveTab] = useState<"query" | "config" | "tools">(
    "query"
  );
  const [config, setConfig] = useState<{
    system_prompt: string;
    schema: string;
  } | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Tools state
  const [tools, setTools] = useState<
    Array<{
      name: string;
      description?: string;
      inputSchema?: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
    }>
  >([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [toolParams, setToolParams] = useState<Record<string, unknown>>({});
  const [toolExecuting, setToolExecuting] = useState(false);
  const [toolResult, setToolResult] = useState<unknown>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["Database Query", "Database Management"])
  );

  // Tool categorization function
  const categorizeTools = (
    toolsList: Array<{
      name: string;
      description?: string;
      inputSchema?: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
    }>
  ) => {
    const categories: Record<string, typeof toolsList> = {};

    toolsList.forEach((tool: (typeof toolsList)[0]) => {
      let category = "Other";

      // Categorize based on tool name and description
      if (
        tool.name.includes("show_tables") ||
        tool.name.includes("describe_table")
      ) {
        category = "Database Schema";
      } else if (
        tool.name.includes("list_table") ||
        tool.name.includes("select") ||
        tool.description?.toLowerCase().includes("select")
      ) {
        category = "Database Query";
      } else if (
        tool.name.includes("execute_sql") ||
        tool.name.includes("mysql_execute")
      ) {
        category = "Database Management";
      } else if (
        tool.name.includes("insert") ||
        tool.description?.toLowerCase().includes("insert")
      ) {
        category = "Data Insert";
      } else if (
        tool.name.includes("update") ||
        tool.description?.toLowerCase().includes("update")
      ) {
        category = "Data Update";
      } else if (
        tool.name.includes("delete") ||
        tool.description?.toLowerCase().includes("delete")
      ) {
        category = "Data Delete";
      } else if (
        tool.name.includes("create") ||
        tool.name.includes("drop") ||
        tool.name.includes("alter")
      ) {
        category = "Schema Management";
      }

      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(tool);
    });

    return categories;
  };

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  // Load configuration and tools on component mount
  useEffect(() => {
    loadConfig();
    loadTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch config when model/provider changes
  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  async function loadConfig() {
    setConfigLoading(true);
    setConfigError(null);
    try {
      // Fetch config via backend
      const data = await apiFetchConfig(
        model === "custom" ? "custom" : "deepseek"
      );
      setConfig({
        system_prompt: data.system_prompt,
        schema: data.schema || "",
      });
      if (!model && typeof (data as { model?: string })?.model === "string") {
        setModel(((data as { model?: string }).model as string) || "");
      }
    } catch (err: unknown) {
      // If config fetch fails, don't show error - just silently fail
      console.warn("Configuration fetch failed:", err);
      setConfig(null);
    } finally {
      setConfigLoading(false);
    }
  }

  async function loadTools() {
    setToolsLoading(true);
    setToolsError(null);
    try {
      const data = await apiFetchTools();
      const normalized = (data.tools || []).map(
        (tool: Record<string, unknown>) => {
          const inputSchema =
            (tool as Record<string, unknown>).inputSchema ||
            (tool as Record<string, unknown>).input_schema ||
            null;
          return {
            ...tool,
            inputSchema,
          };
        }
      );
      setTools(normalized as typeof tools);
    } catch (err: unknown) {
      console.warn("Tools fetch failed:", err);
      setTools([]);
    } finally {
      setToolsLoading(false);
    }
  }

  async function executeTool(toolName: string, args: Record<string, unknown>) {
    setToolExecuting(true);
    setToolsError(null);
    try {
      const data = await apiCallTool(toolName, args);
      setToolResult(data.result);
      return data.result;
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Tool execution failed";
      setToolsError(errorMessage);
      throw err;
    } finally {
      setToolExecuting(false);
    }
  }

  async function saveConfig(newConfig: {
    system_prompt?: string;
    schema?: string;
  }) {
    setConfigLoading(true);
    setConfigError(null);
    try {
      // Save config via backend
      await apiUpdateConfig(
        newConfig,
        model === "custom" ? "custom" : "deepseek"
      );
      await loadConfig();
      return true;
    } catch (err: unknown) {
      setConfigError(
        err instanceof Error ? err.message : "Failed to save configuration"
      );
      return false;
    } finally {
      setConfigLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Validation: query must be provided
    if (!query.trim()) {
      setError("Please enter a query");
      return;
    }

    setLoading(true);
    setError(null);
    setRaw(null);
    setGeneratedSql(null);
    setExecutionResult(null);
    setModelOutput(null);
    setDebugData(null);
    setSchemaSource(null);
    try {
      const data = await apiGenerate({
        prompt: query,
        schema: customSchema,
        provider: provider as "deepseek" | "custom",
        ...(model ? { model } : {}),
      });
      setRaw(data);
      setGeneratedSql(typeof data.sql === "string" ? data.sql : null);
      setModelOutput(
        typeof data.rawModelOutput === "string" ? data.rawModelOutput : null
      );
      setExecutionResult(data.executionResult ?? null);
      setDebugData(data.debug || null);
      setSchemaSource(
        typeof data.schemaSource === "string" ? data.schemaSource : null
      );
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Request failed";

      // Handle specific configuration service errors more gracefully
      if (
        err instanceof Error &&
        err.message.includes("Configuration service")
      ) {
        setError(
          "System configuration is currently unavailable. Please try again later."
        );
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-black to-zinc-900 text-white">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iNCIvPjwvZz48L2c+PC9zdmc+')] opacity-40"></div>

      <div className="relative max-w-6xl mx-auto p-6">
        <header className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                  <span className="text-xl font-bold">M</span>
                </div>
                <div>
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                    MCP Workspace
                  </h1>
                  <p className="text-sm text-gray-400">
                    Natural language to MCP Toolbox tools
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                className="text-xs px-3 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/50 text-zinc-200"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                title="Model"
              >
                <option value="">Default</option>
                <option value="deepseek-chat">deepseek-chat</option>
                <option value="deepseek-reasoner">deepseek-reasoner</option>
                <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                <option value="custom">Custom</option>
              </select>
              <button
                onClick={toggleDebugMode}
                className={`text-xs px-4 py-2 inline-flex items-center rounded-xl transition-all duration-300 transform hover:scale-105 ${
                  debugMode
                    ? "bg-gradient-to-r from-blue-500/20 to-blue-600/20 text-blue-300 border border-blue-500/30 shadow-lg shadow-blue-500/20"
                    : "bg-zinc-800/50 backdrop-blur-sm text-zinc-300 hover:bg-zinc-700/50 border border-zinc-700/50"
                }`}
              >
                🔍 Debug {debugMode ? "ON" : "OFF"}
              </button>

              <div
                className={`text-xs px-4 py-2 inline-flex items-center rounded-xl border backdrop-blur-sm ${
                  loading || configLoading
                    ? "bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border-amber-500/30 shadow-lg shadow-amber-500/20"
                    : hasResults
                    ? "bg-gradient-to-r from-emerald-500/20 to-green-500/20 text-emerald-300 border-emerald-500/30 shadow-lg shadow-emerald-500/20"
                    : "bg-zinc-800/50 text-zinc-300 border-zinc-700/50"
                }`}
              >
                {loading ||
                  (configLoading && (
                    <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-2"></div>
                  ))}
                {loading || configLoading
                  ? "Processing"
                  : hasResults
                  ? "✅ Ready"
                  : "⚫ Idle"}
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2 bg-zinc-900/50 backdrop-blur-xl rounded-2xl p-2 border border-zinc-800/50 shadow-2xl">
            <button
              onClick={() => setActiveTab("query")}
              className={`px-6 py-3 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 ${
                activeTab === "query"
                  ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/25"
                  : "text-zinc-300 hover:text-white hover:bg-zinc-800/50 border border-transparent hover:border-zinc-700/50"
              }`}
            >
              <span className="flex items-center gap-2">
                📝 <span>SQL Query</span>
              </span>
            </button>
            <button
              onClick={() => setActiveTab("tools")}
              className={`px-6 py-3 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 ${
                activeTab === "tools"
                  ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25"
                  : "text-zinc-300 hover:text-white hover:bg-zinc-800/50 border border-transparent hover:border-zinc-700/50"
              }`}
            >
              <span className="flex items-center gap-2">
                🔧 <span>Tools</span>
              </span>
            </button>
            <button
              onClick={() => setActiveTab("config")}
              className={`px-6 py-3 rounded-xl text-sm font-medium transition-all duration-300 transform hover:scale-105 ${
                activeTab === "config"
                  ? "bg-gradient-to-r from-orange-500 to-red-600 text-white shadow-lg shadow-orange-500/25"
                  : "text-zinc-300 hover:text-white hover:bg-zinc-800/50 border border-transparent hover:border-zinc-700/50"
              }`}
            >
              <span className="flex items-center gap-2">
                ⚙️ <span>Configuration</span>
              </span>
            </button>
          </div>
        </header>

        {/* Query Tab Content */}
        {activeTab === "query" && (
          <div className="bg-zinc-900/30 backdrop-blur-xl rounded-3xl p-4 md:p-8 border border-zinc-800/50 shadow-2xl">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold mb-2 text-zinc-100 flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                    Query
                  </label>
                  <textarea
                    className="w-full h-36 rounded-2xl border border-zinc-700/50 bg-zinc-800/50 backdrop-blur-sm text-zinc-100 placeholder:text-zinc-500 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 shadow-xl transition-all duration-300"
                    placeholder="e.g., Which customers purchased in the last 30 days?"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-4 pt-2">
                <button
                  type="submit"
                  className="px-8 py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-purple-600 text-white text-sm font-medium disabled:opacity-60 shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 transform disabled:hover:scale-100"
                  disabled={loading || !query.trim()}
                >
                  <span className="flex items-center gap-2">
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin"></div>
                        Submitting...
                      </>
                    ) : (
                      <>Submit</>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className="px-8 py-3 rounded-2xl border border-zinc-600/50 text-sm font-medium hover:bg-zinc-800/50 backdrop-blur-sm transition-all duration-300 transform hover:scale-105 text-zinc-300 hover:text-white"
                  onClick={() => {
                    setQuery("");
                    setCustomSchema("");
                    setError(null);
                    setRaw(null);
                    setGeneratedSql(null);
                    setExecutionResult(null);
                    setModelOutput(null);
                    setDebugData(null);
                    setSchemaSource(null);
                  }}
                >
                  <span className="flex items-center gap-2"> Clear</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tools Tab Content */}
        {activeTab === "tools" && (
          <ToolsPanel
            tools={tools}
            loading={toolsLoading}
            error={toolsError}
            selectedTool={selectedTool}
            onSelectTool={setSelectedTool}
            toolParams={toolParams}
            onUpdateParams={setToolParams}
            executing={toolExecuting}
            result={toolResult}
            onExecute={executeTool}
            onRefresh={loadTools}
            categorizeTools={categorizeTools}
            expandedCategories={expandedCategories}
            onToggleCategory={toggleCategory}
          />
        )}

        {/* Configuration Tab Content */}
        {activeTab === "config" && (
          <ConfigurationPanel
            config={config}
            loading={configLoading}
            error={configError}
            onSave={saveConfig}
          />
        )}

        {/* Results section - only show on query tab */}
        {activeTab === "query" && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {error && (
              <div className="rounded-lg border border-red-800 bg-red-950 text-red-300 p-3 text-sm md:col-span-2">
                Error: {error}
              </div>
            )}
            {generatedSql && (
              <SqlCard
                sql={generatedSql}
                loading={loading}
                schemaSource={schemaSource}
              />
            )}

            {modelOutput && modelOutput !== generatedSql && (
              <ModelOutputCard output={modelOutput} />
            )}

            {executionResult != null && (
              <ExecutionResultCard
                result={executionResult as Record<string, unknown>}
                loading={loading}
              />
            )}

            {raw != null && (
              <details className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white/60 dark:bg-zinc-900/40 shadow-sm md:col-span-2">
                <summary className="cursor-pointer text-sm">
                  Raw Response
                </summary>
                <pre className="mt-2 bg-gray-50 dark:bg-gray-900 rounded p-2 whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(raw, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Debug Panel - only show on query tab */}
        {activeTab === "query" && debugMode && debugData && (
          <div className="mt-6">
            <DebugPanel
              debug={debugData}
              onClearDebug={() => setDebugData(null)}
            />
          </div>
        )}
      </div>
      {loading && <LoadingOverlay />}
    </div>
  );
}

function ExecutionResultCard({
  result,
  loading,
}: {
  result: unknown;
  loading?: boolean;
}) {
  const [tab, setTab] = useState<"table" | "json">("table");
  const rows = useMemo(() => extractRows(result), [result]);
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-white/70 dark:bg-zinc-900/50 shadow md:col-span-2">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">SQL Execution Result</h2>
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setTab("table")}
            className={`px-2 py-1 rounded ${
              tab === "table"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 dark:bg-gray-800"
            }`}
          >
            Table
          </button>
          <button
            onClick={() => setTab("json")}
            className={`px-2 py-1 rounded ${
              tab === "json"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 dark:bg-gray-800"
            }`}
          >
            JSON
          </button>
        </div>
      </div>
      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-gray-500">Loading...</div>
        ) : tab === "table" ? (
          rows.length > 0 ? (
            <DataTable rows={rows} />
          ) : (
            <div className="text-xs text-gray-500">
              No table data to display
            </div>
          )
        ) : (
          <pre className="text-xs whitespace-pre-wrap break-words">
            {JSON.stringify(result ?? {}, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function SqlCard({
  sql,
  loading,
  schemaSource,
}: {
  sql: string;
  loading?: boolean;
  schemaSource?: string | null;
}) {
  const showSource = schemaSource && schemaSource !== "none";
  const sourceLabel = showSource ? schemaSourceLabel(schemaSource) : null;
  return (
    <div className="rounded-2xl border border-blue-500/30 bg-blue-600/10 p-4 shadow-md">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-blue-100">Generated SQL</h2>
        <button
          className="text-xs px-3 py-1 rounded-lg bg-blue-500/20 text-blue-100 border border-blue-500/40 hover:bg-blue-500/30"
          onClick={() => navigator.clipboard?.writeText(sql)}
          disabled={loading}
        >
          Copy
        </button>
      </div>
      {sourceLabel && (
        <div className="text-xs text-blue-200 mb-2">
          Schema source: {sourceLabel}
        </div>
      )}
      <pre className="bg-blue-900/30 border border-blue-700/40 rounded p-3 text-xs whitespace-pre-wrap break-words text-blue-100">
        {sql}
      </pre>
    </div>
  );
}

function ModelOutputCard({ output }: { output: string }) {
  return (
    <div className="rounded-2xl border border-purple-500/30 bg-purple-600/10 p-4 shadow-md">
      <h2 className="text-sm font-semibold text-purple-100 mb-2">
        Model Output
      </h2>
      <pre className="bg-purple-900/30 border border-purple-700/40 rounded p-3 text-xs whitespace-pre-wrap break-words text-purple-100">
        {output}
      </pre>
    </div>
  );
}

function LoadingOverlay() {
  const phrases = useMemo(
    () => [
      "SELECT * FROM",
      "DESCRIBE table",
      "SHOW TABLES",
      "WHERE id = ?",
      "INSERT INTO",
      "UPDATE ... SET",
      "DELETE WHERE",
      "ORDER BY",
      "GROUP BY",
      "LIMIT 50",
      "JOIN ... ON",
      "VALUES (...)",
      "SET x = y",
      "FROM gateway_data",
    ],
    []
  );
  const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>_-+=[]{}()#%^*";
  const makeRandom = (len: number) =>
    Array.from(
      { length: len },
      () => glyphs[Math.floor(Math.random() * glyphs.length)]
    ).join("");
  const initTiles = () =>
    Array.from({ length: 14 }, (_, i) =>
      i % 3 === 0 ? phrases[i % phrases.length] : makeRandom(8)
    );

  const [tiles, setTiles] = useState<string[]>(initTiles());
  const [active, setActive] = useState<Set<number>>(new Set());

  useEffect(() => {
    const interval = setInterval(() => {
      setTiles((prev) => {
        const next = [...prev];
        // randomly scramble a few tiles
        for (let k = 0; k < 3; k++) {
          const idx = Math.floor(Math.random() * next.length);
          const src = next[idx];
          // sometimes snap to a phrase, otherwise scramble
          if (Math.random() < 0.18) {
            next[idx] = phrases[Math.floor(Math.random() * phrases.length)];
          } else {
            const chars = src.split("");
            const pos = Math.floor(Math.random() * Math.max(4, chars.length));
            if (chars[pos])
              chars[pos] = glyphs[Math.floor(Math.random() * glyphs.length)];
            next[idx] = chars.join("");
          }
        }
        return next;
      });
      setActive(() => {
        const s = new Set<number>();
        // pulse a few tiles as "processed"
        for (let i = 0; i < 4; i++)
          s.add(Math.floor(Math.random() * tiles.length));
        return s;
      });
    }, 180);
    return () => clearInterval(interval);
  }, [phrases, glyphs, tiles.length]);

  return (
    <div
      className="loader-overlay"
      role="status"
      aria-live="polite"
      aria-label="Processing"
    >
      <div className="loader-card">
        <div className="loader-header">
          <span className="loader-badge">MCP</span>
          <div className="loader-title">Model processing your request…</div>
        </div>
        <div className="loader-body">
          <div className="relative flex items-center justify-center">
            <div className="ring">
              <div className="orbit">
                <div className="dot" />
                <div className="dot" />
                <div className="dot" />
              </div>
            </div>
          </div>
          <div>
            <div className="conveyor mb-3" aria-hidden>
              <div className="belt">
                {[...tiles, ...tiles].map((t, i) => (
                  <div
                    key={i}
                    className={`tile ${
                      active.has(i % tiles.length) ? "active" : ""
                    }`}
                  >
                    <code className="tile-text">{t}</code>
                  </div>
                ))}
              </div>
            </div>
            <div className="meta">
              <div className="line" />
              <div className="line" style={{ width: "70%" }} />
              <div className="line" style={{ width: "85%" }} />
            </div>
          </div>
        </div>
        <div className="footer">
          <div>Composing tools and validating steps…</div>
          <div>ETA: indeterminate</div>
        </div>
      </div>
    </div>
  );
}

function StepResultViewer({ result }: { result: unknown }) {
  const [tab, setTab] = useState<"table" | "json">("table");
  const rows = useMemo(() => extractRows(result), [result]);
  const hasRows = rows.length > 0;

  return (
    <div className="mt-2">
      <div className="flex gap-2 text-xs">
        <button
          onClick={() => setTab("table")}
          className={`px-2 py-1 rounded ${
            tab === "table"
              ? "bg-emerald-600 text-white"
              : "bg-gray-200 dark:bg-gray-800"
          }`}
        >
          Table
        </button>
        <button
          onClick={() => setTab("json")}
          className={`px-2 py-1 rounded ${
            tab === "json"
              ? "bg-emerald-600 text-white"
              : "bg-gray-200 dark:bg-gray-800"
          }`}
        >
          JSON
        </button>
        <button
          onClick={() =>
            navigator.clipboard?.writeText(JSON.stringify(result, null, 2))
          }
          className="ml-auto px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:brightness-105"
        >
          Copy
        </button>
      </div>
      <div className="mt-2">
        {tab === "table" ? (
          hasRows ? (
            <DataTable rows={rows} />
          ) : (
            <div className="text-xs text-gray-500">
              No table data to display
            </div>
          )
        ) : (
          <pre className="text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto custom-scroll">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function DebugPanel({
  debug,
  onClearDebug,
}: {
  debug: DebugPayload;
  onClearDebug?: () => void;
}) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-700 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔍</span>
          <h3 className="text-lg font-semibold text-zinc-100">
            AI Debug Panel
          </h3>
          {typeof debug.totalDurationMs === "number" && (
            <span className="text-xs px-2 py-1 bg-blue-900/40 text-blue-300 rounded-full">
              {debug.totalDurationMs}ms total
            </span>
          )}
          {debug.mode && (
            <span className="text-xs px-2 py-1 bg-green-900/40 text-green-300 rounded-full">
              {debug.mode}
            </span>
          )}
        </div>
        <button
          onClick={() => {
            if (confirm("Do you want to clear the debug data?")) {
              onClearDebug?.();
            }
          }}
          className="text-xs px-3 py-1 bg-red-900/40 text-red-300 border border-red-700/50 rounded-lg hover:bg-red-900/60 transition-colors"
        >
          🗑️ Clear
        </button>
      </div>

      <div className="space-y-3">
        {debug.schema && (
          <details
            className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-3"
            open
          >
            <summary className="cursor-pointer text-sm text-zinc-200">
              Schema Details
            </summary>
            <div className="mt-2 text-xs text-zinc-300 space-y-1">
              {debug.schema.source && (
                <div>
                  Source:{" "}
                  <span className="text-zinc-100">
                    {schemaSourceLabel(debug.schema.source)}
                  </span>
                </div>
              )}
              {typeof debug.schema.length === "number" && (
                <div>
                  Length:{" "}
                  <span className="text-zinc-100">{debug.schema.length}</span>{" "}
                  characters
                </div>
              )}
            </div>
            {debug.schema.snippet && (
              <pre className="mt-2 bg-zinc-900 border border-zinc-700 rounded p-2 text-[11px] max-h-48 overflow-auto whitespace-pre-wrap break-words text-zinc-200">
                {debug.schema.snippet}
                {debug.schema.length &&
                  debug.schema.snippet.length < debug.schema.length &&
                  "\n..."}
              </pre>
            )}
          </details>
        )}

        <details
          className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-3"
          open
        >
          <summary className="cursor-pointer text-sm text-zinc-200">
            Deepseek Request
          </summary>
          <div className="mt-2">
            <DebugJsonCard title="Body" value={debug.deepseek?.request} />
          </div>
        </details>

        <details
          className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-3"
          open
        >
          <summary className="cursor-pointer text-sm text-zinc-200">
            Deepseek Response
          </summary>
          <div className="mt-2">
            <DebugJsonCard title="Response" value={debug.deepseek?.response} />
          </div>
        </details>

        <details
          className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-3"
          open
        >
          <summary className="cursor-pointer text-sm text-zinc-200">
            MCP Execution
          </summary>
          <div className="mt-2 space-y-2">
            {typeof debug.execution?.durationMs === "number" && (
              <div className="text-xs text-zinc-400">
                Duration:{" "}
                <span className="text-zinc-200">
                  {debug.execution.durationMs}ms
                </span>
              </div>
            )}
            <DebugJsonCard title="Result" value={debug.execution?.result} />
          </div>
        </details>

        <details className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-3">
          <summary className="cursor-pointer text-sm text-zinc-200">
            Full Debug Payload
          </summary>
          <div className="mt-2">
            <DebugJsonCard title="Debug" value={debug} />
          </div>
        </details>
      </div>
    </div>
  );
}

function ConfigurationPanel({
  config,
  loading,
  error,
  onSave,
}: {
  config: { system_prompt: string; schema: string } | null;
  loading: boolean;
  error: string | null;
  onSave: (config: {
    system_prompt?: string;
    schema?: string;
  }) => Promise<boolean>;
}) {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [schema, setSchema] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Update local state when config loads
  useEffect(() => {
    if (config) {
      setSystemPrompt(config.system_prompt);
      setSchema(config.schema);
      setHasChanges(false);
    }
  }, [config]);

  // Track changes
  useEffect(() => {
    if (config) {
      const changed =
        systemPrompt !== config.system_prompt || schema !== config.schema;
      setHasChanges(changed);
    }
  }, [systemPrompt, schema, config]);

  const handleSave = async () => {
    if (!config) return;

    const updates: { system_prompt?: string; schema?: string } = {};
    if (systemPrompt !== config.system_prompt)
      updates.system_prompt = systemPrompt;
    if (schema !== config.schema) updates.schema = schema;

    if (Object.keys(updates).length > 0) {
      const success = await onSave(updates);
      if (success) {
        setHasChanges(false);
      }
    }
  };

  const handleReset = () => {
    if (config) {
      setSystemPrompt(config.system_prompt);
      setSchema(config.schema);
      setHasChanges(false);
    }
  };

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-zinc-400">Loading configuration...</div>
      </div>
    );
  }

  if (!loading && !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-zinc-400">
          The configuration service is currently unavailable.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 text-red-300 p-3 text-sm">
          Error: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {/* System Prompt */}
        <div>
          <label className="block text-sm font-medium mb-2 text-zinc-100">
            System Prompt
          </label>
          <textarea
            className="w-full h-48 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 p-3 text-sm focus:outline-none shadow-sm font-mono"
            placeholder="Enter system instructions for the AI assistant..."
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            disabled={loading}
          />
          <p className="text-xs text-zinc-400 mt-1">
            System instructions provided to the AI model. It follows these rules
            when generating SQL queries.
          </p>
        </div>

        {/* Database Schema */}
        <div>
          <label className="block text-sm font-medium mb-2 text-zinc-100">
            Database Schema
          </label>
          <textarea
            className="w-full h-64 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 p-3 text-sm focus:outline-none shadow-sm font-mono"
            placeholder="CREATE TABLE statements and database schema..."
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            disabled={loading}
          />
          <p className="text-xs text-zinc-400 mt-1">
            Default database schema. The AI uses this schema to generate SQL
            queries.
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4 border-t border-zinc-800">
        <button
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60 shadow hover:brightness-110 transition"
          disabled={loading || !hasChanges}
        >
          {loading ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900 transition"
          disabled={loading || !hasChanges}
        >
          Reset
        </button>
        <div className="flex-1" />
        {hasChanges && (
          <span className="text-xs text-amber-400 self-center">
            There are unsaved changes
          </span>
        )}
      </div>
    </div>
  );
}

function DebugJsonCard({ title, value }: { title: string; value: unknown }) {
  let displayValue: string;
  try {
    displayValue = JSON.stringify(value, null, 2) ?? "null";
  } catch {
    displayValue = String(value);
  }
  if (displayValue === undefined) {
    displayValue = "undefined";
  }

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3">
      <h5 className="text-xs font-semibold text-zinc-300 mb-2">{title}</h5>
      <pre className="text-[11px] text-zinc-300 bg-zinc-900 border border-zinc-600 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">
        {displayValue}
      </pre>
    </div>
  );
}
function ToolsPanel({
  tools,
  loading,
  error,
  selectedTool,
  onSelectTool,
  toolParams,
  onUpdateParams,
  executing,
  result,
  onExecute,
  onRefresh,
  categorizeTools,
  expandedCategories,
  onToggleCategory,
}: {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: {
      type: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
  }>;
  loading: boolean;
  error: string | null;
  selectedTool: string | null;
  onSelectTool: (tool: string | null) => void;
  toolParams: Record<string, unknown>;
  onUpdateParams: (params: Record<string, unknown>) => void;
  executing: boolean;
  result: unknown;
  onExecute: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<unknown>;
  onRefresh: () => void;
  categorizeTools: (
    toolsList: Array<{
      name: string;
      description?: string;
      inputSchema?: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
    }>
  ) => Record<
    string,
    Array<{
      name: string;
      description?: string;
      inputSchema?: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
    }>
  >;
  expandedCategories: Set<string>;
  onToggleCategory: (category: string) => void;
}) {
  const selectedToolData = tools.find((t) => t.name === selectedTool);
  const categorizedTools = categorizeTools(tools);

  // Category icons mapping
  const categoryIcons: Record<string, string> = {
    "Database Schema": "🗄️",
    "Database Query": "🔍",
    "Database Management": "⚙️",
    "Data Insert": "➕",
    "Data Update": "✏️",
    "Data Delete": "🗑️",
    "Schema Management": "🔧",
    Other: "📋",
  };

  const handleExecute = async () => {
    if (!selectedTool) return;
    try {
      await onExecute(selectedTool, toolParams);
    } catch (err) {
      console.error("Tool execution failed:", err);
    }
  };

  const handleParamChange = (key: string, value: unknown) => {
    onUpdateParams({
      ...toolParams,
      [key]: value,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-zinc-400">Loading tools...</div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/30 backdrop-blur-xl rounded-3xl p-4 md:p-8 border border-zinc-800/50 shadow-2xl space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            🔧 Available Tools
          </h2>
          <p className="text-sm text-zinc-400 flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
            {tools.length} tools available
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 hover:from-emerald-500/30 hover:to-teal-500/30 text-emerald-300 text-sm font-medium border border-emerald-500/30 transition-all duration-300 transform hover:scale-105 backdrop-blur-sm"
          disabled={loading}
        >
          <span className="flex items-center gap-2">
            {loading ? (
              <div className="w-4 h-4 border border-current border-t-transparent rounded-full animate-spin"></div>
            ) : (
              "🔄"
            )}
            Refresh
          </span>
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-gradient-to-r from-red-500/10 to-pink-500/10 backdrop-blur-sm text-red-300 p-4 text-sm shadow-lg">
          <span className="flex items-center gap-2">
            ⚠️ <strong>Error:</strong> {error}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8">
        {/* Categorized Tools List */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
            <span className="w-3 h-3 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full"></span>
            Tool Categories
          </h3>
          <div className="space-y-4 max-h-96 overflow-y-auto tools-scroll">
            {Object.entries(categorizedTools).map(
              ([category, categoryTools]) => (
                <div
                  key={category}
                  className="border border-zinc-700/50 rounded-2xl bg-gradient-to-br from-zinc-800/40 to-zinc-900/60 backdrop-blur-sm shadow-xl hover:shadow-2xl transition-all duration-300"
                >
                  {/* Category Header */}
                  <button
                    onClick={() => onToggleCategory(category)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-zinc-800/30 transition-all duration-300 rounded-2xl group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl group-hover:scale-110 transition-transform duration-300">
                        {categoryIcons[category]}
                      </span>
                      <div className="space-y-1">
                        <span className="font-semibold text-zinc-100 group-hover:text-white transition-colors">
                          {category}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-400 bg-zinc-700/50 px-3 py-1 rounded-full border border-zinc-600/30">
                            {categoryTools.length} tool
                          </span>
                          {expandedCategories.has(category) && (
                            <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">
                              Expanded
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="text-zinc-400 text-xl group-hover:text-zinc-200 transition-colors">
                      {expandedCategories.has(category) ? "▼" : "▶"}
                    </span>
                  </button>

                  {/* Category Tools */}
                  {expandedCategories.has(category) && (
                    <div className="border-t border-zinc-700/30 bg-zinc-900/60 rounded-b-2xl max-h-64 overflow-y-auto category-scroll">
                      {categoryTools.map((tool: (typeof tools)[0]) => (
                        <button
                          key={tool.name}
                          onClick={() => {
                            onSelectTool(tool.name);
                            onUpdateParams({});
                          }}
                          className={`w-full text-left p-4 border-b border-zinc-700/30 last:border-b-0 transition-all duration-300 group hover:bg-zinc-800/40 ${
                            selectedTool === tool.name
                              ? "bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-blue-300 border-blue-500/30 shadow-lg"
                              : "text-zinc-300 hover:text-zinc-100"
                          } first:rounded-none last:rounded-b-2xl`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="space-y-1">
                              <div className="font-medium text-sm group-hover:text-white transition-colors">
                                {tool.name}
                              </div>
                              {tool.description && (
                                <div className="text-xs text-zinc-400 line-clamp-2 group-hover:text-zinc-300 transition-colors">
                                  {tool.description}
                                </div>
                              )}
                            </div>
                            {selectedTool === tool.name && (
                              <div className="flex items-center gap-1">
                                <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
                                <span className="text-xs text-blue-300">
                                  Selected
                                </span>
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </div>

        {/* Tool Details & Execution */}
        <div className="space-y-6">
          {selectedToolData ? (
            <div className="bg-gradient-to-br from-zinc-800/30 to-zinc-900/50 rounded-3xl p-6 border border-zinc-700/50 backdrop-blur-sm shadow-2xl space-y-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-2xl border border-blue-500/30 flex items-center justify-center">
                    <span className="text-blue-400">🛠️</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-100">
                      {selectedToolData.name}
                    </h3>
                    <span className="text-xs text-zinc-400 bg-zinc-700/50 px-2 py-1 rounded-full">
                      Active Tool
                    </span>
                  </div>
                </div>
                {selectedToolData.description && (
                  <p className="text-sm text-zinc-300 bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30">
                    {selectedToolData.description}
                  </p>
                )}
              </div>

              {/* Parameters */}
              {selectedToolData.inputSchema?.properties && (
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
                    <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
                    Parameters
                  </h4>
                  <div className="space-y-4 max-h-80 overflow-y-auto category-scroll">
                    {Object.entries(
                      selectedToolData.inputSchema.properties
                    ).map(([key, schema]) => (
                      <div key={key} className="space-y-2">
                        <label className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                          {key}
                          {selectedToolData.inputSchema?.required?.includes(
                            key
                          ) && (
                            <span className="text-red-400 text-xs bg-red-500/20 px-2 py-1 rounded-full border border-red-500/30">
                              Required *
                            </span>
                          )}
                        </label>
                        <input
                          type="text"
                          className="w-full rounded-2xl border border-zinc-700/50 bg-zinc-800/50 backdrop-blur-sm text-zinc-100 placeholder:text-zinc-500 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 shadow-lg transition-all duration-300"
                          placeholder={`Enter a value for ${key}...`}
                          value={String(toolParams[key] || "")}
                          onChange={(e) =>
                            handleParamChange(key, e.target.value)
                          }
                        />
                        {(() => {
                          const desc = (schema as Record<string, unknown>)
                            ?.description;
                          if (desc && typeof desc === "string") {
                            return (
                              <p className="text-xs text-zinc-400 bg-zinc-800/30 rounded-lg p-2">
                                💡 {desc}
                              </p>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Execute Button */}
              <button
                onClick={handleExecute}
                className="w-full px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-bold disabled:opacity-60 shadow-2xl hover:shadow-emerald-500/25 hover:scale-105 transition-all duration-300 transform disabled:hover:scale-100"
                disabled={executing || !selectedTool}
              >
                <span className="flex items-center justify-center gap-3">
                  {executing ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Running...
                    </>
                  ) : (
                    <>
                      🚀 <span>Run Tool</span>
                    </>
                  )}
                </span>
              </button>

              {/* Result */}
              {result != null && (
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                    Result
                  </h4>
                  <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 backdrop-blur-sm shadow-xl">
                    <div className="p-6 max-h-96 overflow-y-auto tools-scroll">
                      <StepResultViewer result={result} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400 space-y-4">
              <div className="w-20 h-20 bg-gradient-to-br from-zinc-700/30 to-zinc-800/30 rounded-3xl flex items-center justify-center border border-zinc-700/50">
                <span className="text-3xl">🛠️</span>
              </div>
              <div className="text-center space-y-2">
                <p className="text-lg font-medium text-zinc-300">Select a Tool</p>
                <p className="text-sm text-zinc-500">
                  Start by selecting a tool from the left
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
