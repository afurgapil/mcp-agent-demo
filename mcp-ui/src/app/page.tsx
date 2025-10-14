"use client";

import { useMemo, useState, useEffect } from "react";
import {
  getToken,
  getMe,
  listSessions,
  createSession,
  appendSessionMessages,
  getSession,
  type ChatSessionSummary,
  renameSession,
  deleteSession,
} from "../services/api";
import { useRouter } from "next/navigation";
import {
  getDebugStatus,
  toggleDebug as apiToggleDebug,
  fetchTools as apiFetchTools,
  callTool as apiCallTool,
  generate as apiGenerate,
} from "../services/api";
import HomeHeader from "../components/home/HomeHeader";
import SidebarTabs from "../components/home/SidebarTabs";
import QueryTab from "../components/home/QueryTab";
import ChatTab from "../components/home/ChatTab";
import ToolsPanel, { type ToolDefinition } from "../components/home/ToolsPanel";
import SavedPrompts from "../components/home/SavedPrompts";
import LoadingOverlay from "../components/home/LoadingOverlay";
import BulkInsertTab from "../components/home/BulkInsertTab";
import type {
  DebugPayload,
  PlannerSummary,
  ToolCallInfo,
  ChatMessage,
} from "../types/home";
import ConfirmModal from "../components/home/ConfirmModal";

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
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
    // load sessions from backend
    listSessions()
      .then((xs) => {
        setSessions(xs);
        if (xs.length > 0) setCurrentSessionId(xs[0].sessionId);
      })
      .catch(() => setSessions([]));
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

  // load messages of selected session
  useEffect(() => {
    if (!currentSessionId) return;
    getSession(currentSessionId)
      .then((s) => setMessages(s.messages as unknown as ChatMessage[]))
      .catch(() => setMessages([]));
  }, [currentSessionId]);

  const toggleDebugMode = async () => {
    try {
      const data = await apiToggleDebug();
      setDebugMode(!!data.debugMode);
    } catch (err) {
      console.error("Failed to toggle debug mode:", err);
    }
  };

  const [activeTab, setActiveTab] = useState<
    "chat" | "query" | "tools" | "history" | "insert"
  >("chat");
  const [useRagHints, setUseRagHints] = useState<boolean>(false);

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
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

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

  // Load and persist RAG toggle
  useEffect(() => {
    try {
      const saved = localStorage.getItem("rag_hints");
      if (saved != null) setUseRagHints(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("rag_hints", JSON.stringify(useRagHints));
    } catch {}
  }, [useRagHints]);

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
    setMessages([]);
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

    // Ensure a session exists or create one
    let sid = currentSessionId;
    if (!sid) {
      try {
        const s = await createSession(query.slice(0, 60) || "New Chat");
        setSessions((prev) => [s, ...prev]);
        setCurrentSessionId(s.sessionId);
        sid = s.sessionId;
      } catch {}
    }

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: query,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setQuery("");
    try {
      const data = await apiGenerate({
        prompt: query,
        schema: customSchema,
        provider: provider as "deepseek" | "custom",
        ...(model ? { model } : {}),
        useToolset,
        useRagHints,
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
      const assistantContent =
        (typeof data.rawModelOutput === "string" && data.rawModelOutput) ||
        (typeof data.sql === "string" && data.sql) ||
        "";
      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        content: assistantContent,
        sql: typeof data.sql === "string" ? data.sql : null,
        modelOutput:
          typeof data.rawModelOutput === "string" ? data.rawModelOutput : null,
        executionResult: data.executionResult ?? null,
        toolCall: nextToolCall,
        strategy:
          data && data.strategy === "tool"
            ? "tool"
            : data && data.strategy === "sql"
            ? "sql"
            : null,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      if (sid) {
        appendSessionMessages(sid, [userMessage, assistantMessage]).catch(
          () => {}
        );
      }
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
      const assistantError: ChatMessage = {
        id: `${Date.now()}-assistant-error`,
        role: "assistant",
        content: `Error: ${errorMessage}`,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, assistantError]);
      if (sid) {
        appendSessionMessages(sid, [userMessage, assistantError]).catch(
          () => {}
        );
      }
    } finally {
      setLoading(false);
    }
  }

  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    oldTitle: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-black to-zinc-900 text-white">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iNCIvPjwvZz48L2c+PC9zdmc+')] opacity-40"></div>
      <div className="relative max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-4">
        <HomeHeader
          model={model}
          onModelChange={setModel}
          debugMode={debugMode}
          onToggleDebug={toggleDebugMode}
          useRagHints={useRagHints}
          onToggleRagHints={() => setUseRagHints((v) => !v)}
          useToolset={useToolset}
          onToggleToolset={() => setUseToolset((v) => !v)}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          companyName={me?.company?.name || null}
          branchName={me?.branch?.name || null}
        />

        <div className="relative flex gap-x-6">
          {!leftCollapsed && (
            <aside className="hidden md:block w-60 lg:w-56 shrink-0">
              <div className="sticky top-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-zinc-400">Menu</div>
                  <button
                    className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                    onClick={() => setLeftCollapsed(true)}
                    title="Hide"
                  >
                    ⟨
                  </button>
                </div>
                <SidebarTabs active={activeTab} onChange={setActiveTab} />
              </div>
            </aside>
          )}
          <main className="flex-1 min-w-0">
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

            {activeTab === "chat" && (
              <div className="relative flex gap-x-6">
                <div className={`flex-1 min-w-0`}>
                  <ChatTab
                    query={query}
                    onQueryChange={setQuery}
                    onSubmit={handleSubmit}
                    loading={loading}
                    messages={messages}
                  />
                </div>
                {!rightCollapsed && (
                  <aside className="hidden lg:block w-56 shrink-0">
                    <div className="sticky top-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-zinc-400">Chats</div>
                        <div className="flex items-center gap-2">
                          <button
                            className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                            onClick={async () => {
                              try {
                                const s = await createSession("New Chat");
                                setSessions((prev) => [s, ...prev]);
                                setCurrentSessionId(s.sessionId);
                                setMessages([]);
                              } catch {}
                            }}
                          >
                            New
                          </button>
                          <button
                            className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                            onClick={() => setRightCollapsed(true)}
                            title="Hide panel"
                          >
                            ➜
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
                        {sessions.map((s) => (
                          <div
                            key={s.sessionId}
                            className={`px-3 py-2 rounded-lg text-xs border transition flex items-start justify-between gap-2 ${
                              currentSessionId === s.sessionId
                                ? "bg-blue-500/10 text-blue-200 border-blue-500/30"
                                : "bg-zinc-900/50 text-zinc-300 border-zinc-800 hover:bg-zinc-900/70"
                            }`}
                          >
                            <button
                              className="flex-1 text-left"
                              onClick={async () => {
                                setCurrentSessionId(s.sessionId);
                                try {
                                  const full = await getSession(s.sessionId);
                                  setMessages(
                                    full.messages as unknown as ChatMessage[]
                                  );
                                } catch {
                                  setMessages([]);
                                }
                              }}
                              title={s.title}
                            >
                              <div className="truncate">
                                {s.title || "(untitled)"}
                              </div>
                              <div className="text-[10px] text-zinc-500">
                                {s.createdAt
                                  ? new Date(s.createdAt).toLocaleString()
                                  : ""}
                              </div>
                            </button>
                            <div className="flex items-center gap-1">
                              <button
                                className="p-1 rounded bg-zinc-800 hover:bg-zinc-700"
                                title="Rename chat"
                                onClick={() =>
                                  setRenameTarget({
                                    id: s.sessionId,
                                    oldTitle: s.title,
                                  })
                                }
                              >
                                ✏️
                              </button>
                              <button
                                className="p-1 rounded bg-zinc-800 hover:bg-zinc-700"
                                title="Delete chat"
                                onClick={() => setDeleteTarget(s.sessionId)}
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))}
                        {sessions.length === 0 && (
                          <div className="text-[11px] text-zinc-500">
                            No chats yet
                          </div>
                        )}
                      </div>
                    </div>
                  </aside>
                )}
                {leftCollapsed && (
                  <button
                    className="hidden md:block absolute left-2 top-0 mt-1 text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                    onClick={() => setLeftCollapsed(false)}
                    title="Show menu"
                  >
                    ⟩
                  </button>
                )}
                {rightCollapsed && (
                  <button
                    className="hidden lg:block absolute right-2 top-0 mt-1 text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                    onClick={() => setRightCollapsed(false)}
                    title="Show chats"
                  >
                    ◀
                  </button>
                )}
              </div>
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

            {activeTab === "insert" && (
              <BulkInsertTab
                fetchTables={async () => {
                  try {
                    // Ensure the tool exists and call it
                    const result = await executeTool(
                      "postgres_show_tables",
                      {}
                    );
                    function isRecord(
                      val: unknown
                    ): val is Record<string, unknown> {
                      return typeof val === "object" && val !== null;
                    }
                    // Try rows shape first
                    let tables: string[] = [];
                    if (isRecord(result)) {
                      const rowsVal = (result as Record<string, unknown>)[
                        "rows"
                      ];
                      if (Array.isArray(rowsVal)) {
                        for (const r of rowsVal) {
                          if (isRecord(r)) {
                            const first = Object.values(r)[0];
                            if (typeof first === "string") tables.push(first);
                          }
                        }
                      }
                      if (tables.length === 0) {
                        const contentVal = (result as Record<string, unknown>)[
                          "content"
                        ];
                        if (Array.isArray(contentVal)) {
                          const collected: string[] = [];
                          for (const item of contentVal) {
                            if (isRecord(item)) {
                              const textVal = item["text"];
                              if (typeof textVal === "string") {
                                const raw = textVal;
                                try {
                                  const obj = JSON.parse(raw);
                                  if (isRecord(obj)) {
                                    const first = Object.values(obj)[0];
                                    if (typeof first === "string")
                                      collected.push(first);
                                  }
                                } catch {
                                  const t = raw.trim();
                                  if (t) collected.push(t);
                                }
                              }
                            }
                          }
                          tables = collected;
                        }
                      }
                    }
                    const unique = Array.from(new Set(tables)).filter(
                      (x): x is string => typeof x === "string" && x.length > 0
                    );
                    return unique;
                  } catch {
                    // Fallback: query information_schema directly via execute_sql
                    try {
                      const res = await executeTool("postgres_execute_sql", {
                        sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
                      });
                      const rows = res?.rows;
                      if (Array.isArray(rows)) {
                        const names: string[] = [];
                        for (const r of rows) {
                          const v = r?.table_name ?? Object.values(r || {})[0];
                          if (typeof v === "string" && v) names.push(v);
                        }
                        return Array.from(new Set(names));
                      }
                    } catch {}
                    return [];
                  }
                }}
                describeTable={async (table: string) => {
                  try {
                    const res = await executeTool("postgres_describe_table", {
                      table: table,
                    });
                    function isRecord(
                      val: unknown
                    ): val is Record<string, unknown> {
                      return typeof val === "object" && val !== null;
                    }
                    if (isRecord(res)) {
                      const rowsVal = (res as Record<string, unknown>)["rows"];
                      if (Array.isArray(rowsVal)) {
                        return rowsVal as Array<Record<string, unknown>>;
                      }
                      const contentVal = (res as Record<string, unknown>)[
                        "content"
                      ];
                      if (Array.isArray(contentVal)) {
                        const rows: Array<Record<string, unknown>> = [];
                        for (const item of contentVal) {
                          if (
                            isRecord(item) &&
                            typeof item["text"] === "string"
                          ) {
                            try {
                              const obj = JSON.parse(String(item["text"]));
                              if (Array.isArray(obj)) {
                                for (const r of obj)
                                  if (isRecord(r)) rows.push(r);
                              } else if (isRecord(obj)) {
                                rows.push(obj);
                              }
                            } catch {}
                          }
                        }
                        return rows.length > 0 ? rows : null;
                      }
                    }
                    return null;
                  } catch {
                    return null;
                  }
                }}
                viewTableData={async (
                  table: string,
                  limit: number,
                  offset: number
                ) => {
                  try {
                    const res = await executeTool("list_table_limited", {
                      tableName: table,
                      limit,
                      offset,
                    });
                    function isRecord(
                      val: unknown
                    ): val is Record<string, unknown> {
                      return typeof val === "object" && val !== null;
                    }
                    if (isRecord(res)) {
                      const rowsVal = (res as Record<string, unknown>)["rows"];
                      if (Array.isArray(rowsVal))
                        return rowsVal as Array<Record<string, unknown>>;
                      const contentVal = (res as Record<string, unknown>)[
                        "content"
                      ];
                      if (Array.isArray(contentVal)) {
                        const rows: Array<Record<string, unknown>> = [];
                        for (const item of contentVal) {
                          if (
                            isRecord(item) &&
                            typeof item["text"] === "string"
                          ) {
                            try {
                              const obj = JSON.parse(String(item["text"]));
                              if (Array.isArray(obj)) {
                                for (const r of obj)
                                  if (isRecord(r)) rows.push(r);
                              } else if (isRecord(obj)) {
                                rows.push(obj);
                              }
                            } catch {}
                          }
                        }
                        return rows;
                      }
                    }
                    return [];
                  } catch {
                    return [];
                  }
                }}
                executeSql={async (sql: string) => {
                  return await executeTool("postgres_execute_sql", { sql });
                }}
              />
            )}

            {activeTab === "history" && <SavedPrompts />}
          </main>
        </div>
      </div>
      {loading && activeTab !== "chat" && <LoadingOverlay />}
      <ConfirmModal
        open={!!renameTarget}
        title="Rename chat"
        description="Enter a new title."
        inputPlaceholder="Title"
        defaultValue={renameTarget?.oldTitle || ""}
        confirmText="Save"
        cancelText="Cancel"
        onConfirm={async (val) => {
          if (!renameTarget) return;
          try {
            if (val && val.trim()) {
              await renameSession(renameTarget.id, val.trim());
              setSessions((prev) =>
                prev.map((x) =>
                  x.sessionId === renameTarget.id
                    ? { ...x, title: val.trim() }
                    : x
                )
              );
            }
          } catch {}
          setRenameTarget(null);
        }}
        onClose={() => setRenameTarget(null)}
      />
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete chat"
        description="This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteSession(deleteTarget);
            setSessions((prev) =>
              prev.filter((x) => x.sessionId !== deleteTarget)
            );
            if (currentSessionId === deleteTarget) {
              setCurrentSessionId(null);
              setMessages([]);
            }
          } catch {}
          setDeleteTarget(null);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
