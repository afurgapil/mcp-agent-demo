"use client";

import { useMemo, useState } from "react";
import { DataTable } from "..";
import { extractRows } from "../../utils/format";

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
            <div className="text-xs text-gray-500">No table data to display</div>
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

export type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

export default function ToolsPanel({
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
  tools: ToolDefinition[];
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
    toolsList: ToolDefinition[]
  ) => Record<string, ToolDefinition[]>;
  expandedCategories: Set<string>;
  onToggleCategory: (category: string) => void;
}) {
  const selectedToolData = tools.find((t) => t.name === selectedTool);
  const categorizedTools = categorizeTools(tools);

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
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
            <span className="w-3 h-3 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full"></span>
            Tool Categories
          </h3>
          <div className="space-y-4 max-h-96 overflow-y-auto tools-scroll">
            {Object.entries(categorizedTools).map(([category, categoryTools]) => (
              <div
                key={category}
                className="border border-zinc-700/50 rounded-2xl bg-gradient-to-br from-zinc-800/40 to-zinc-900/60 backdrop-blur-sm shadow-xl hover:shadow-2xl transition-all duration-300"
              >
                <button
                  onClick={() => onToggleCategory(category)}
                  className="w-full px-4 py-3 flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3">
                    <span>{categoryIcons[category] || "📦"}</span>
                    <span className="text-sm font-semibold text-zinc-200">
                      {category}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {categoryTools.length} tools
                    </span>
                  </div>
                  <span className="text-zinc-400">
                    {expandedCategories.has(category) ? "▲" : "▼"}
                  </span>
                </button>
                {expandedCategories.has(category) && (
                  <div className="px-4 pb-4 space-y-2">
                    {categoryTools.map((tool) => (
                      <button
                        key={tool.name}
                        onClick={() => onSelectTool(tool.name)}
                        className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-300 ${
                          selectedTool === tool.name
                            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                            : "border-zinc-700/40 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600/40 hover:bg-zinc-900/60"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{tool.name}</span>
                          <span className="text-xs text-zinc-500">Select</span>
                        </div>
                        {tool.description && (
                          <p className="mt-2 text-xs text-zinc-400 line-clamp-2">
                            {tool.description}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          {selectedToolData ? (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500/30 to-purple-500/30 rounded-2xl border border-blue-500/30 flex items-center justify-center">
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

              {selectedToolData.inputSchema?.properties && (
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
                    <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
                    Parameters
                  </h4>
                  <div className="space-y-4 max-h-80 overflow-y-auto category-scroll">
                    {Object.entries(selectedToolData.inputSchema.properties).map(
                      ([key, schema]) => (
                        <div key={key} className="space-y-2">
                          <label className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                            {key}
                            {selectedToolData.inputSchema?.required?.includes(key) && (
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
                            onChange={(e) => handleParamChange(key, e.target.value)}
                          />
                          {(() => {
                            const desc = (schema as Record<string, unknown>)?.description;
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
                      )
                    )}
                  </div>
                </div>
              )}

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
                <p className="text-sm text-zinc-500">Start by selecting a tool from the left</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
