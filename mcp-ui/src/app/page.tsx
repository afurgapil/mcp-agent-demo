"use client";

import { useMemo, useState, useEffect } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Step = { tool: string; args?: Record<string, unknown> };
type Plan = { steps?: Step[]; rationale?: string } & Partial<Step>;
type StepResult = {
  index: number;
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

type MCPResult = {
  content?: Array<{ text?: string }>;
  rows?: Array<Record<string, unknown>>;
  // Allow extra properties without using any
  [key: string]: unknown;
};

// Extract row objects from a typical MCP result
function extractRows(result: unknown): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  if (!result || typeof result !== "object") return rows;
  const r = result as MCPResult;
  // Common pattern: content: [{ type: 'text', text: '{"k":"v"}' }, ...]
  if (Array.isArray(r.content)) {
    for (const item of r.content) {
      const txt = item?.text;
      if (typeof txt === "string") {
        try {
          const obj = JSON.parse(txt);
          if (obj && typeof obj === "object") rows.push(obj);
        } catch {
          // ignore non-JSON lines
        }
      }
    }
  }
  // Fallbacks: some tools may return direct arrays/rows
  if (Array.isArray(r.rows)) {
    for (const obj of r.rows) {
      if (obj && typeof obj === "object")
        rows.push(obj as Record<string, unknown>);
    }
  }
  return rows;
}

function DataTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows || rows.length === 0) return null;
  const cols = Array.from(new Set(rows.flatMap((o) => Object.keys(o))));
  const limited = rows.slice(0, 50);
  return (
    <div className="overflow-x-auto border border-zinc-800 rounded-lg mt-2 shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-900 text-gray-300">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {limited.map((row, i) => (
            <tr
              key={i}
              className="border-t border-zinc-800 hover:bg-zinc-900/60 transition"
            >
              {cols.map((c) => (
                <td
                  key={c}
                  className="px-3 py-2 align-top whitespace-pre-wrap break-words"
                >
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limited.length && (
        <div className="px-3 py-2 text-xs text-gray-500">
          Showing first {limited.length} rows of {rows.length}
        </div>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// Debug panel types
type DebugInfo = {
  originalQuery?: string;
  processedQuery?: string;
  thinkingModelInput?: Record<string, unknown>;
  thinkingModelOutput?: string;
  nlToSqlInput?: Record<string, unknown>;
  nlToSqlOutput?: string;
  stages?: Record<string, string>;
  executionResult?: unknown;
  // New debug fields from backend
  debug?: {
    mode: string;
    request: {
      endpoint: string;
      query: string;
      timestamp: string;
    };
    aiCalls: Array<{
      modelName: string;
      input: unknown;
      output: unknown;
      duration: number;
      timestamp: string;
      metadata: Record<string, unknown>;
    }>;
    stages: Array<{
      stage: string;
      timestamp: string;
      data: unknown;
    }>;
    totalDuration: number;
  };
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [customSchema, setCustomSchema] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [execSteps, setExecSteps] = useState<StepResult[]>([]);
  const [raw, setRaw] = useState<unknown>(null);
  const hasResults = useMemo(
    () => !!summary || execSteps.length > 0 || !!plan,
    [summary, execSteps, plan]
  );
  const finalStep = execSteps.length ? execSteps[execSteps.length - 1] : null;
  const finalResult = finalStep?.result;
  const [openPlan, setOpenPlan] = useState(true);
  const [openSteps, setOpenSteps] = useState(true);

  // Debug panel state
  const [debugMode, setDebugMode] = useState(true);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  // Check debug mode status on mount
  useEffect(() => {
    const checkDebugMode = async () => {
      try {
        const res = await fetch(`${API_BASE.replace(/\/$/, "")}/debug/status`);
        if (res.ok) {
          const data = await res.json();
          setDebugMode(data.debugMode || false);
        }
      } catch (err) {
        console.warn("Could not check debug mode status:", err);
      }
    };
    checkDebugMode();
  }, []);

  // Toggle debug mode on backend
  const toggleDebugMode = async () => {
    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/debug/toggle`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setDebugMode(data.debugMode);
        console.log(`Debug mode ${data.debugMode ? "enabled" : "disabled"}`);
      }
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
  }, []);

  async function loadConfig() {
    setConfigLoading(true);
    setConfigError(null);
    try {
      // Fetch config via backend (which proxies to external LLM service)
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/api/config`);
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      } else {
        // If config fetch fails, don't show error - just silently fail
        console.warn("Configuration service unavailable");
        setConfig(null);
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
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/tools`);
      if (res.ok) {
        const data = await res.json();
        setTools(data.tools || []);
      } else {
        console.warn("Tools service unavailable");
        setTools([]);
      }
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
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/tool`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: toolName,
          args: args,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setToolResult(data.result);
        return data.result;
      } else {
        const errorData = await res.json();
        throw new Error(errorData?.error || "Tool execution failed");
      }
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
      // Save config via backend (which proxies to external LLM service)
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/api/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newConfig),
      });

      if (res.ok) {
        // Reload config to get updated values
        await loadConfig();
        return true;
      } else {
        const errorData = await res.json();
        throw new Error(
          errorData?.detail?.[0]?.msg || "Configuration kaydetme hatası"
        );
      }
    } catch (err: unknown) {
      setConfigError(
        err instanceof Error ? err.message : "Configuration kaydetme hatası"
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
      setError("Lütfen sorgu girin");
      return;
    }

    setLoading(true);
    setError(null);
    setPlan(null);
    setSummary(null);
    setRaw(null);
    setExecSteps([]);
    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/nl`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          customSchema: customSchema,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      setPlan(data.plan ?? null);
      setExecSteps(Array.isArray(data.steps) ? data.steps : []);
      setSummary(data.summary ?? null);
      setRaw(data);

      // Extract debug information from response - ensure all data exists
      const debugData: DebugInfo = {
        originalQuery: data.originalQuery || query,
        processedQuery: data.processedQuery || query,
        thinkingModelInput: { message: query, max_tokens: 300 },
        thinkingModelOutput: data.processedQuery || query,
        nlToSqlInput: {
          question: data.processedQuery || query,
          schema: customSchema || "default schema",
        },
        nlToSqlOutput: data.sql || "No SQL generated",
        stages: data.stages || {},
        executionResult: data.executionResult,
        debug: data.debug || null, // Backend debug info
      };

      // Only set debug info if we have meaningful data
      if (data.debug || data.originalQuery || data.processedQuery || data.sql) {
        setDebugInfo(debugData);
      } else {
        setDebugInfo(null);
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "İstek başarısız oldu";

      // Handle specific configuration service errors more gracefully
      if (
        err instanceof Error &&
        err.message.includes("Configuration service")
      ) {
        setError(
          "Sistem konfigürasyonu şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin."
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
                    🚀 Natural language to MCP Toolbox tools
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
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
                  ? "Çalışıyor"
                  : hasResults
                  ? "✅ Hazır"
                  : "⚫ Boşta"}
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
                📝 <span>SQL Sorgu</span>
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
                🔧 <span>Araçlar</span>
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
                ⚙️ <span>Konfigürasyon</span>
              </span>
            </button>
          </div>
        </header>

        {/* Query Tab Content */}
        {activeTab === "query" && (
          <div className="bg-zinc-900/30 backdrop-blur-xl rounded-3xl p-4 md:p-8 border border-zinc-800/50 shadow-2xl">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold mb-2 text-zinc-100 flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                    Sorgu
                  </label>
                  <textarea
                    className="w-full h-36 rounded-2xl border border-zinc-700/50 bg-zinc-800/50 backdrop-blur-sm text-zinc-100 placeholder:text-zinc-500 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 shadow-xl transition-all duration-300"
                    placeholder="örn., Son 30 gün içinde alışveriş yapan müşteriler kimler?"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold mb-2 text-zinc-100 flex items-center gap-2">
                    <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
                    Veritabanı Şeması (Opsiyonel)
                  </label>
                  <textarea
                    className="w-full h-36 rounded-2xl border border-zinc-700/50 bg-zinc-800/50 backdrop-blur-sm text-zinc-100 placeholder:text-zinc-500 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 shadow-xl font-mono transition-all duration-300"
                    placeholder={`Özel şema girin veya boş bırakın (varsayılan şema kullanılacak)

CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT
);`}
                    value={customSchema}
                    onChange={(e) => setCustomSchema(e.target.value)}
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
                        Gönderiliyor...
                      </>
                    ) : (
                      <>Gönder</>
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
                    setPlan(null);
                    setSummary(null);
                    setRaw(null);
                    setExecSteps([]);
                  }}
                >
                  <span className="flex items-center gap-2"> Temizle</span>
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

        {/* Primary Result right under input - only show on query tab */}
        {activeTab === "query" && finalResult ? (
          <ResultCard
            result={finalResult as Record<string, unknown>}
            loading={loading}
          />
        ) : null}

        {/* Results section - only show on query tab */}
        {activeTab === "query" && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {error && (
              <div className="rounded-lg border border-red-800 bg-red-950 text-red-300 p-3 text-sm md:col-span-2">
                Error: {error}
              </div>
            )}
            {false && (
              <div className="rounded-xl w-full border border-gray-200 dark:border-gray-800 p-0 bg-white/60 dark:bg-zinc-900/40 shadow-sm">
                <header className="flex items-center justify-between px-4 py-3">
                  <h2 className="font-medium">Plan</h2>
                  <button
                    onClick={() => setOpenPlan((v) => !v)}
                    className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800"
                  >
                    {openPlan ? "Gizle" : "Göster"}
                  </button>
                </header>
                {openPlan && (
                  <div className="px-4 pb-4">
                    {Array.isArray(plan?.steps) && plan!.steps!.length > 0 ? (
                      <PlanRoadmap steps={plan!.steps as Step[]} />
                    ) : (
                      <div className="rounded bg-gray-50 dark:bg-gray-900 p-2 text-sm">
                        Tek adımlı plan
                      </div>
                    )}
                    {plan?.rationale && (
                      <div className="mt-3 text-sm">
                        <span className="font-semibold">Gerekçe: </span>
                        {plan?.rationale}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {false && (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-0 bg-white/60 dark:bg-zinc-900/40 shadow-sm md:col-span-2">
                <header className="flex items-center justify-between px-4 py-3">
                  <h2 className="font-medium">Adımlar</h2>
                  <button
                    onClick={() => setOpenSteps((v) => !v)}
                    className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800"
                  >
                    {openSteps ? "Gizle" : "Göster"}
                  </button>
                </header>
                {openSteps && <StepTimeline steps={execSteps} />}
              </div>
            )}
            {false && (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white/60 dark:bg-zinc-900/40 shadow-sm md:col-span-2">
                <h2 className="font-medium mb-2">Özet</h2>
                <p className="text-sm whitespace-pre-wrap">{summary}</p>
              </div>
            )}
            {/* AI Raw Response */}
            {raw && (raw as Record<string, unknown>).sql ? (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white/60 dark:bg-zinc-900/40 shadow-sm">
                <h3 className="text-sm font-medium mb-2">
                  AI&apos;dan Gelen Response
                </h3>
                <pre className="bg-gray-50 dark:bg-gray-900 rounded p-2 whitespace-pre-wrap break-words text-xs">
                  {String((raw as Record<string, unknown>).sql)}
                </pre>
              </div>
            ) : null}

            {/* SQL Execution Result */}
            {raw && (raw as Record<string, unknown>).executionResult ? (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white/60 dark:bg-zinc-900/40 shadow-sm">
                <h3 className="text-sm font-medium mb-2">
                  SQL Execution Result
                </h3>
                <pre className="bg-gray-50 dark:bg-gray-900 rounded p-2 whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(
                    (raw as Record<string, unknown>).executionResult,
                    null,
                    2
                  )}
                </pre>
              </div>
            ) : null}

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
        {activeTab === "query" && debugMode && debugInfo && (
          <div className="mt-6">
            <DebugPanel
              debugInfo={debugInfo}
              onClearDebug={() => setDebugInfo(null)}
            />
          </div>
        )}
      </div>
      {loading && <LoadingOverlay />}
    </div>
  );
}

function ResultCard({
  result,
  summary,
  loading,
}: {
  result: unknown;
  summary?: string;
  loading?: boolean;
}) {
  const [tab, setTab] = useState<"table" | "json">("table");
  const rows = useMemo(() => extractRows(result), [result]);
  return (
    <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-white/70 dark:bg-zinc-900/50 shadow">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Sonuç</h2>
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setTab("table")}
            className={`px-2 py-1 rounded ${
              tab === "table"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 dark:bg-gray-800"
            }`}
          >
            Tablo
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
      {summary && <p className="mt-2 text-sm text-gray-600">{summary}</p>}
      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-gray-500">Yükleniyor...</div>
        ) : tab === "table" ? (
          rows.length > 0 ? (
            <DataTable rows={rows} />
          ) : (
            <div className="text-xs text-gray-500">
              Gösterilecek tablo verisi yok
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

function StepTimeline({ steps }: { steps: StepResult[] }) {
  return (
    <div className="px-4 pb-4">
      <h3 className="font-medium mb-2">Zaman Çizelgesi</h3>
      <ol className="relative border-l border-gray-200 dark:border-gray-800 ml-2 h-96 overflow-auto pr-2 custom-scroll">
        {steps.map((st) => (
          <li key={st.index} className="ml-4 mb-4">
            <div
              className={`w-2 h-2 rounded-full border -ml-[33px] mt-2 ${
                st.error
                  ? "bg-red-500 border-red-600"
                  : "bg-green-500 border-green-600"
              }`}
            />
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-sm">
                  Adım {st.index + 1}:{" "}
                  <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
                    {st.tool}
                  </span>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    st.error
                      ? "bg-red-100 text-red-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {st.error ? "Hata" : "Başarılı"}
                </span>
              </div>
              {st.args && (
                <pre className="mt-2 text-xs whitespace-pre-wrap break-words max-h-40 overflow-auto custom-scroll">
                  {JSON.stringify(st.args, null, 2)}
                </pre>
              )}
              {st.error ? (
                <div className="mt-2 text-red-600 text-sm">{st.error}</div>
              ) : (
                <StepResultViewer result={st.result} />
              )}
            </div>
          </li>
        ))}
      </ol>
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
              ? "bg-blue-600 text-white"
              : "bg-gray-200 dark:bg-gray-800"
          }`}
        >
          Tablo
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
        <button
          onClick={() =>
            navigator.clipboard?.writeText(JSON.stringify(result, null, 2))
          }
          className="ml-auto px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:brightness-105"
        >
          Kopyala
        </button>
      </div>
      <div className="mt-2">
        {tab === "table" ? (
          hasRows ? (
            <DataTable rows={rows} />
          ) : (
            <div className="text-xs text-gray-500">
              Gösterilecek tablo verisi yok
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

function useColumns() {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const calc = () => {
      const w = typeof window !== "undefined" ? window.innerWidth : 1024;
      if (w < 640) setCols(1);
      else if (w < 768) setCols(2);
      else if (w < 1280) setCols(3);
      else setCols(4);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return cols;
}

function PlanRoadmap({ steps }: { steps: Step[] }) {
  const cols = useColumns();
  const rows: Step[][] = [];
  for (let i = 0; i < steps.length; i += cols)
    rows.push(steps.slice(i, i + cols));
  return (
    <div className="py-2 h-80 overflow-auto pr-2 custom-scroll">
      {rows.map((row, rIdx) => {
        const even = rIdx % 2 === 0; // 0-based: first row L→R, second R→L
        const items = even ? row : [...row].reverse();
        return (
          <div key={rIdx} className="mb-3">
            <div className="flex items-stretch gap-3">
              {items.map((s, i) => (
                <div
                  key={`${rIdx}-${i}`}
                  className="flex items-center gap-3 flex-1 min-w-0"
                >
                  <div className="rounded-lg bg-sky-50 dark:bg-sky-900/30 border border-sky-100 dark:border-sky-800 p-3 shadow-sm w-full">
                    <div className="text-xs text-sky-700 dark:text-sky-300 font-semibold">
                      Step {rIdx * cols + (even ? i + 1 : row.length - i)}
                    </div>
                    <div className="mt-1">
                      <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
                        {s.tool}
                      </span>
                    </div>
                    {s.args && (
                      <pre className="mt-2 text-[11px] whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300 max-h-28 overflow-auto custom-scroll">
                        {JSON.stringify(s.args, null, 2)}
                      </pre>
                    )}
                  </div>
                  {i < items.length - 1 && (
                    <div className="text-gray-400 text-xl select-none">
                      {even ? "→" : "←"}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {rIdx < rows.length - 1 && (
              <div
                className={`flex ${
                  even ? "justify-end" : "justify-start"
                } mt-1`}
              >
                <div className="text-gray-400 select-none">↓</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DebugPanel({
  debugInfo,
  onClearDebug,
}: {
  debugInfo: DebugInfo | null;
  onClearDebug?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<
    "aiCalls" | "stages" | "timeline" | "raw"
  >("aiCalls");

  if (!debugInfo) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-700 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">🔍</span>
          <h3 className="text-lg font-semibold text-zinc-100">
            AI Debug Panel
          </h3>
        </div>
        <div className="text-zinc-400 text-sm bg-zinc-800/50 rounded-lg p-4">
          <p className="mb-2">🔍 Debug verisi bulunamadı</p>
          <p className="text-xs">
            Debug modu aktif olsa bile, veri henüz mevcut değil. Bir sorgu
            gönderin veya backend&apos;den debug verisi geldiğinden emin olun.
          </p>
        </div>
      </div>
    );
  }

  const tabs = [
    {
      id: "aiCalls",
      label: "AI Calls",
      icon: "🤖",
      count: debugInfo.debug?.aiCalls?.length || 0,
    },
    {
      id: "stages",
      label: "Stages",
      icon: "📊",
      count:
        debugInfo.debug?.stages?.length ||
        Object.keys(debugInfo.stages || {}).length,
    },
    {
      id: "timeline",
      label: "Timeline",
      icon: "⏱️",
      count: debugInfo.debug?.aiCalls?.length || 0,
    },
    {
      id: "raw",
      label: "Raw Data",
      icon: "🔧",
      count: debugInfo.debug ? 2 : 1,
    },
  ] as const;

  return (
    <div className="bg-zinc-900/50 border border-zinc-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔍</span>
          <h3 className="text-lg font-semibold text-zinc-100">
            AI Debug Panel
          </h3>
          {debugInfo.debug?.totalDuration && (
            <span className="text-xs px-2 py-1 bg-blue-900/40 text-blue-300 rounded-full">
              {debugInfo.debug.totalDuration}ms total
            </span>
          )}
          {debugInfo.debug?.mode && (
            <span className="text-xs px-2 py-1 bg-green-900/40 text-green-300 rounded-full">
              {debugInfo.debug.mode}
            </span>
          )}
        </div>
        <button
          onClick={() => {
            if (confirm("Debug verilerini temizlemek istiyor musunuz?")) {
              onClearDebug?.();
            }
          }}
          className="text-xs px-3 py-1 bg-red-900/40 text-red-300 border border-red-700/50 rounded-lg hover:bg-red-900/60 transition-colors"
          title="Debug verilerini temizle"
        >
          🗑️ Temizle
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-1 mb-4 bg-zinc-800 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-zinc-700 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-zinc-600 rounded-full">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === "aiCalls" && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-zinc-300 mb-2">
              🤖 AI Model Communications
            </h4>
            {debugInfo.debug?.aiCalls?.length ? (
              debugInfo.debug.aiCalls.map((call, index) => (
                <div
                  key={index}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h5 className="font-semibold text-zinc-200">
                        {call.modelName}
                      </h5>
                      <div className="text-xs text-zinc-400">
                        {new Date(call.timestamp).toLocaleString("tr-TR")}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-1 bg-blue-900/40 text-blue-300 rounded-full">
                        {call.duration}ms
                      </span>
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          call.metadata.success
                            ? "bg-green-900/40 text-green-300"
                            : "bg-red-900/40 text-red-300"
                        }`}
                      >
                        {call.metadata.success ? "✅ Başarılı" : "❌ Hatalı"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <h6 className="text-xs font-medium text-zinc-400 mb-2">
                        📥 INPUT
                      </h6>
                      <div className="bg-zinc-900 border border-zinc-600 rounded p-3 max-h-48 overflow-auto">
                        <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words">
                          {typeof call.input === "string"
                            ? call.input
                            : JSON.stringify(call.input, null, 2)}
                        </pre>
                      </div>
                    </div>
                    <div>
                      <h6 className="text-xs font-medium text-zinc-400 mb-2">
                        📤 OUTPUT
                      </h6>
                      <div className="bg-zinc-900 border border-zinc-600 rounded p-3 max-h-48 overflow-auto">
                        <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words">
                          {typeof call.output === "string"
                            ? call.output
                            : JSON.stringify(call.output, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>

                  {call.metadata && Object.keys(call.metadata).length > 0 && (
                    <details className="mt-3">
                      <summary className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-200">
                        📊 Metadata
                      </summary>
                      <div className="mt-2 bg-zinc-900 border border-zinc-600 rounded p-2">
                        <pre className="text-xs text-zinc-400">
                          {JSON.stringify(call.metadata, null, 2)}
                        </pre>
                      </div>
                    </details>
                  )}
                </div>
              ))
            ) : (
              <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-4">
                <div className="text-zinc-400 text-sm mb-2">
                  ❌ AI çağrı verisi bulunamadı
                </div>
                <div className="text-xs text-zinc-500">
                  Debug modunda AI model çağrıları burada görünecek. Şu anda hiç
                  veri yok:
                  <ul className="mt-1 ml-4 list-disc">
                    <li>Backend debug modu kapalı olabilir</li>
                    <li>API çağrısı henüz yapılmamış olabilir</li>
                    <li>Debug verisi henüz işlenmemiş olabilir</li>
                  </ul>
                </div>
                {debugInfo.thinkingModelInput && (
                  <div className="mt-3 p-3 bg-zinc-900/50 rounded border border-zinc-600">
                    <h6 className="text-xs font-medium text-zinc-400 mb-2">
                      📥 Thinking Model Input (Fallback)
                    </h6>
                    <pre className="text-xs text-zinc-300">
                      {JSON.stringify(debugInfo.thinkingModelInput, null, 2)}
                    </pre>
                  </div>
                )}
                {debugInfo.thinkingModelOutput && (
                  <div className="mt-2 p-3 bg-zinc-900/50 rounded border border-zinc-600">
                    <h6 className="text-xs font-medium text-zinc-400 mb-2">
                      📤 Thinking Model Output (Fallback)
                    </h6>
                    <pre className="text-xs text-zinc-300">
                      {debugInfo.thinkingModelOutput}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "stages" && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-zinc-300 mb-2">
              📊 Processing Stages
            </h4>
            {debugInfo.debug?.stages?.length ? (
              debugInfo.debug.stages.map((stage, index) => (
                <div
                  key={index}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-zinc-200">
                      {stage.stage}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {new Date(stage.timestamp).toLocaleString("tr-TR")}
                    </span>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-600 rounded p-3">
                    <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words">
                      {JSON.stringify(stage.data, null, 2)}
                    </pre>
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-4">
                <div className="text-zinc-400 text-sm mb-2">
                  ❌ İşlem aşaması verisi bulunamadı
                </div>
                <div className="text-xs text-zinc-500 mb-3">
                  Debug modunda işlem aşamaları burada görünecek.
                </div>
                {debugInfo.stages &&
                  Object.keys(debugInfo.stages).length > 0 && (
                    <div className="space-y-2">
                      <h6 className="text-xs font-medium text-zinc-400">
                        📊 Mevcut Aşama Bilgileri (Fallback)
                      </h6>
                      {Object.entries(debugInfo.stages).map(([key, value]) => (
                        <div
                          key={key}
                          className="bg-zinc-900/50 border border-zinc-600 rounded p-2"
                        >
                          <div className="text-xs font-medium text-zinc-300">
                            {key}
                          </div>
                          <div className="text-xs text-zinc-400">
                            {String(value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}
          </div>
        )}

        {activeTab === "timeline" && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-zinc-300 mb-2">
              ⏱️ Execution Timeline
            </h4>
            {debugInfo.debug?.aiCalls?.length ? (
              <div className="space-y-2">
                {debugInfo.debug.aiCalls.map((call, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 bg-zinc-800 rounded p-3"
                  >
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <div className="flex-1">
                      <div className="text-sm text-zinc-200">
                        {call.modelName}
                      </div>
                      <div className="text-xs text-zinc-400">
                        {new Date(call.timestamp).toLocaleString("tr-TR")} -{" "}
                        {call.duration}ms
                      </div>
                    </div>
                    <div
                      className={`w-2 h-2 rounded-full ${
                        call.metadata.success ? "bg-green-500" : "bg-red-500"
                      }`}
                    ></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-4">
                <div className="text-zinc-400 text-sm mb-2">
                  ❌ Zaman çizelgesi verisi bulunamadı
                </div>
                <div className="text-xs text-zinc-500">
                  Debug modunda AI çağrılarının zaman çizelgesi burada
                  görünecek.
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "raw" && (
          <div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-2">
              🔧 Raw Debug Data
            </h4>
            <div className="space-y-4">
              {debugInfo.debug && (
                <div>
                  <h5 className="text-xs font-medium text-zinc-400 mb-2">
                    🔧 Backend Debug Data
                  </h5>
                  <div className="bg-zinc-800 border border-zinc-700 rounded p-3 max-h-64 overflow-auto">
                    <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words">
                      {JSON.stringify(debugInfo.debug, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
              <div>
                <h5 className="text-xs font-medium text-zinc-400 mb-2">
                  📋 Complete Debug Info
                </h5>
                <div className="bg-zinc-800 border border-zinc-700 rounded p-3 max-h-96 overflow-auto">
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words">
                    {JSON.stringify(debugInfo, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}
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
        <div className="text-zinc-400">Configuration yükleniyor...</div>
      </div>
    );
  }

  if (!loading && !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-zinc-400">
          Konfigürasyon servisi şu anda kullanılamıyor.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 text-red-300 p-3 text-sm">
          Hata: {error}
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
            placeholder="AI asistanı için sistem talimatları girin..."
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            disabled={loading}
          />
          <p className="text-xs text-zinc-400 mt-1">
            AI modeline verilen sistem talimatları. SQL sorgusu oluştururken bu
            kurallara uyar.
          </p>
        </div>

        {/* Database Schema */}
        <div>
          <label className="block text-sm font-medium mb-2 text-zinc-100">
            Veritabanı Şeması
          </label>
          <textarea
            className="w-full h-64 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 p-3 text-sm focus:outline-none shadow-sm font-mono"
            placeholder="CREATE TABLE statements ve database schema..."
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            disabled={loading}
          />
          <p className="text-xs text-zinc-400 mt-1">
            Varsayılan veritabanı şeması. AI bu şemayı kullanarak SQL sorguları
            oluşturur.
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
          {loading ? "Kaydediliyor..." : "Kaydet"}
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900 transition"
          disabled={loading || !hasChanges}
        >
          Sıfırla
        </button>
        <div className="flex-1" />
        {hasChanges && (
          <span className="text-xs text-amber-400 self-center">
            Kaydedilmemiş değişiklikler var
          </span>
        )}
      </div>
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
        <div className="text-zinc-400">Araçlar yükleniyor...</div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/30 backdrop-blur-xl rounded-3xl p-4 md:p-8 border border-zinc-800/50 shadow-2xl space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            🔧 Mevcut Araçlar
          </h2>
          <p className="text-sm text-zinc-400 flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
            {tools.length} araç mevcut
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
            Yenile
          </span>
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-gradient-to-r from-red-500/10 to-pink-500/10 backdrop-blur-sm text-red-300 p-4 text-sm shadow-lg">
          <span className="flex items-center gap-2">
            ⚠️ <strong>Hata:</strong> {error}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8">
        {/* Categorized Tools List */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
            <span className="w-3 h-3 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full"></span>
            Araç Kategorileri
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
                              Açık
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
                                  Seçili
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
                      Aktif Tool
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
                    Parametreler
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
                              Zorunlu *
                            </span>
                          )}
                        </label>
                        <input
                          type="text"
                          className="w-full rounded-2xl border border-zinc-700/50 bg-zinc-800/50 backdrop-blur-sm text-zinc-100 placeholder:text-zinc-500 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 shadow-lg transition-all duration-300"
                          placeholder={`${key} değeri girin...`}
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
                      Çalıştırılıyor...
                    </>
                  ) : (
                    <>
                      🚀 <span>Aracı Çalıştır</span>
                    </>
                  )}
                </span>
              </button>

              {/* Result */}
              {result != null && (
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                    Sonuç
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
                <p className="text-lg font-medium text-zinc-300">Araç Seçin</p>
                <p className="text-sm text-zinc-500">
                  Sol taraftan bir araç seçerek başlayın
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
