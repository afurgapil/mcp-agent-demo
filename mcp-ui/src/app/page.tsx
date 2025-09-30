"use client";

import { useMemo, useState, useEffect } from "react";
import { getToken, getMe } from "../services/api";
import { useRouter } from "next/navigation";
import {
  getDebugStatus,
  toggleDebug as apiToggleDebug,
  fetchTools as apiFetchTools,
  callTool as apiCallTool,
  generate as apiGenerate,
} from "../services/api";
import HomeHeader from "../components/home/HomeHeader";
import QueryTab from "../components/home/QueryTab";
import ToolsPanel, { type ToolDefinition } from "../components/home/ToolsPanel";
// import ConfigurationPanel from "../components/home/ConfigurationPanel";
import LoadingOverlay from "../components/home/LoadingOverlay";
import type { DebugPayload, PlannerSummary, ToolCallInfo } from "../types/home";

const MODEL_STORAGE_KEY = "mcp_ui_model";

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [customSchema, setCustomSchema] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [generatedSql, setGeneratedSql] = useState<string | null>(null);
  const [modelOutput, setModelOutput] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<unknown>(null);
  const [schemaSource, setSchemaSource] = useState<string | null>(null);

  const [debugMode, setDebugMode] = useState(true);
  const [me, setMe] = useState<{
    name?: string;
    company?: { name?: string } | null;
    branch?: { name?: string } | null;
  } | null>(null);
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

  useEffect(() => {
    // Redirect if unauthenticated
    try {
      const token = getToken();
      if (!token) {
        router.replace("/login");
        return;
      }
    } catch {}

    getDebugStatus()
      .then((d) => setDebugMode(!!d.debugMode))
      .catch(() => {});
    getMe()
      .then((d) => setMe(d.user || null))
      .catch(() => setMe(null));
    try {
      const savedModel =
        typeof window !== "undefined"
          ? localStorage.getItem(MODEL_STORAGE_KEY)
          : null;
      if (savedModel) setModel(savedModel);
    } catch {}
  }, [router]);

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

  const toggleDebugMode = async () => {
    try {
      const data = await apiToggleDebug();
      setDebugMode(!!data.debugMode);
    } catch (err) {
      console.error("Failed to toggle debug mode:", err);
    }
  };

  const [activeTab, setActiveTab] = useState<"query" | "tools">("query");

  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [toolParams, setToolParams] = useState<Record<string, unknown>>({});
  const [toolExecuting, setToolExecuting] = useState(false);
  const [toolResult, setToolResult] = useState<unknown>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["Database Query", "Database Management"])
  );
  const [useToolset, setUseToolset] = useState(false);
  const [strategy, setStrategy] = useState<"tool" | "sql" | null>(null);
  const [toolCall, setToolCall] = useState<ToolCallInfo | null>(null);
  const [plannerInfo, setPlannerInfo] = useState<PlannerSummary | null>(null);
  const [plannerDebug, setPlannerDebug] = useState<unknown>(null);
  // const [syncingEmbedding, setSyncingEmbedding] = useState(false);

  const categorizeTools = (toolsList: ToolDefinition[]) => {
    const categories: Record<string, ToolDefinition[]> = {};

    toolsList.forEach((tool) => {
      let category = "Other";
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

  useEffect(() => {
    loadTools();
  }, []);

  useEffect(() => {}, [model]);

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
      ) as ToolDefinition[];
      setTools(normalized);
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

  // async function saveConfig(newConfig: {
  //   system_prompt?: string;
  //   schema?: string;
  //   toolset?: {
  //     enabled?: boolean;
  //     name?: string;
  //   };
  // }) {
  //   try {
  //     await apiUpdateConfig(
  //       newConfig,
  //       model === "custom" ? "custom" : "deepseek"
  //     );
  //     await loadConfig();
  //     return true;
  //   } catch (err: unknown) {
  //     return false;
  //   }
  // }

  const handleClear = () => {
    setQuery("");
    setCustomSchema("");
    setError(null);
    setRaw(null);
    setGeneratedSql(null);
    setExecutionResult(null);
    setModelOutput(null);
    setDebugData(null);
    setSchemaSource(null);
    setStrategy(null);
    setToolCall(null);
    setPlannerInfo(null);
    setPlannerDebug(null);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

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
    setStrategy(null);
    setToolCall(null);
    setPlannerInfo(null);
    setPlannerDebug(null);
    try {
      const data = await apiGenerate({
        prompt: query,
        schema: customSchema,
        provider: provider as "deepseek" | "custom",
        ...(model ? { model } : {}),
        useToolset,
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
      setStrategy(
        data && data.strategy === "tool"
          ? "tool"
          : data && data.strategy === "sql"
          ? "sql"
          : null
      );
      const plannerPayload =
        data && typeof data.planner === "object" && data.planner !== null
          ? (data.planner as PlannerSummary)
          : null;
      setPlannerInfo(plannerPayload);
      setPlannerDebug(data?.plannerDebug ?? null);
      const nextToolCall = (() => {
        if (!data || typeof data !== "object" || data === null) return null;
        const rawTool = (data as { toolCall?: unknown }).toolCall;
        if (!rawTool || typeof rawTool !== "object") return null;
        const nameValue = (rawTool as { name?: unknown }).name;
        if (typeof nameValue !== "string" || !nameValue.trim()) return null;
        const argsValue = (rawTool as { arguments?: unknown }).arguments;
        const reasonValue = (rawTool as { reason?: unknown }).reason;
        return {
          name: nameValue,
          arguments:
            argsValue && typeof argsValue === "object" && argsValue !== null
              ? (argsValue as Record<string, unknown>)
              : undefined,
          reason:
            typeof reasonValue === "string" && reasonValue.trim()
              ? reasonValue
              : null,
        } satisfies ToolCallInfo;
      })();
      setToolCall(nextToolCall);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Request failed";
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
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iNCIvPjwvZz48L2c+PC9zdmc+')] opacity-40"></div>

      <div className="relative max-w-6xl mx-auto p-6">
        <HomeHeader
          model={model}
          onModelChange={setModel}
          debugMode={debugMode}
          onToggleDebug={toggleDebugMode}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          companyName={me?.company?.name || null}
          branchName={me?.branch?.name || null}
        />

        {activeTab === "query" && (
          <QueryTab
            query={query}
            onQueryChange={setQuery}
            onSubmit={handleSubmit}
            loading={loading}
            error={error}
            generatedSql={generatedSql}
            modelOutput={modelOutput}
            executionResult={executionResult}
            raw={raw}
            useToolset={useToolset}
            onToggleToolset={setUseToolset}
            strategy={strategy}
            toolCall={toolCall}
            plannerInfo={plannerInfo}
            plannerDebug={plannerDebug}
            schemaSource={schemaSource}
            debugMode={debugMode}
            debugData={debugData}
            onClearDebug={() => setDebugData(null)}
            onClear={handleClear}
          />
        )}

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

        {/* config tab removed */}
      </div>
      {loading && <LoadingOverlay />}
    </div>
  );
}
