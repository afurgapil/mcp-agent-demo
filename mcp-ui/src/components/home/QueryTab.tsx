"use client";

import { FormEvent } from "react";
import {
  ExecutionResultCard,
  ModelOutputCard,
  PlannerSummaryCard,
  SqlCard,
} from "./QueryResults";
import DebugPanel from "./DebugPanel";
import { DebugPayload, PlannerSummary, ToolCallInfo } from "../../types/home";
import { schemaSourceLabel } from "../../utils/format";

export default function QueryTab({
  query,
  onQueryChange,
  onSubmit,
  loading,
  error,
  generatedSql,
  modelOutput,
  executionResult,
  raw,
  useToolset,
  onToggleToolset,
  strategy,
  toolCall,
  plannerInfo,
  plannerDebug,
  schemaSource,
  debugMode,
  debugData,
  onClearDebug,
  onClear,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  loading: boolean;
  error: string | null;
  generatedSql: string | null;
  modelOutput: string | null;
  executionResult: unknown;
  raw: unknown;
  useToolset: boolean;
  onToggleToolset: (value: boolean) => void;
  strategy: "tool" | "sql" | null;
  toolCall: ToolCallInfo | null;
  plannerInfo: PlannerSummary | null;
  plannerDebug: unknown;
  schemaSource: string | null;
  debugMode: boolean;
  debugData: DebugPayload | null;
  onClearDebug: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <div className="bg-zinc-900/30 backdrop-blur-xl rounded-3xl p-4 md:p-8 border border-zinc-800/50 shadow-2xl">
        <form onSubmit={onSubmit} className="space-y-6">
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
                onChange={(e) => onQueryChange(e.target.value)}
                data-testid="prompt-input"
              />
            </div>
            <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-2xl px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Prefer MCP tool execution
                </p>
                <p className="text-xs text-zinc-400">
                  When enabled, the assistant tries available tools before
                  generating SQL.
                </p>
                {/* embedding service note hidden */}
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-blue-500 focus:ring-0"
                  checked={useToolset}
                  onChange={(e) => onToggleToolset(e.target.checked)}
                />
                <span>{useToolset ? "On" : "Off"}</span>
              </label>
            </div>
          </div>
          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              className="px-8 py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-purple-600 text-white text-sm font-medium disabled:opacity-60 shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 transform disabled:hover:scale-100"
              disabled={loading || !query.trim()}
              data-testid="submit-button"
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
              onClick={onClear}
            >
              <span className="flex items-center gap-2"> Clear</span>
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {error && (
          <div
            className="rounded-lg border border-red-800 bg-red-950 text-red-300 p-3 text-sm md:col-span-2"
            data-testid="query-error"
          >
            Error: {error}
          </div>
        )}
        {plannerInfo && (
          <PlannerSummaryCard planner={plannerInfo} debugData={plannerDebug} />
        )}
        {strategy && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm md:col-span-2 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-zinc-200">
              <span className="uppercase tracking-wider text-xs text-zinc-500">
                Execution Strategy
              </span>
              <span className="px-2 py-1 rounded-full text-xs bg-zinc-800 text-zinc-100">
                {strategy === "tool" ? "MCP Tool" : "SQL"}
              </span>
            </div>
            {strategy === "tool" && (
              <div className="text-xs text-zinc-400">
                <p>
                  {toolCall?.reason
                    ? toolCall.reason
                    : "The assistant routed the request through an MCP tool before generating SQL."}
                </p>
                {toolCall?.name && (
                  <p className="mt-1 text-zinc-300">
                    Tool used:{" "}
                    <span className="font-medium">{toolCall.name}</span>
                  </p>
                )}
              </div>
            )}
            {strategy === "sql" && (
              <p className="text-xs text-zinc-400">
                The assistant generated SQL with the configured provider.
              </p>
            )}
          </div>
        )}
        {generatedSql && (
          <SqlCard
            sql={generatedSql}
            loading={loading}
            schemaSource={schemaSource}
            schemaSourceLabelValue={schemaSourceLabel}
          />
        )}

        {modelOutput && modelOutput !== generatedSql && (
          <ModelOutputCard output={modelOutput} />
        )}

        {executionResult != null && (
          <ExecutionResultCard
            result={executionResult as Record<string, unknown>}
            loading={loading}
            strategy={strategy}
            toolCall={toolCall}
          />
        )}

        {raw != null && (
          <details className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white/60 dark:bg-zinc-900/40 shadow-sm md:col-span-2">
            <summary className="cursor-pointer text-sm">Raw Response</summary>
            <pre className="mt-2 bg-gray-50 dark:bg-gray-900 rounded p-2 whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(raw, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {debugMode && debugData && (
        <div className="mt-6">
          <DebugPanel debug={debugData} onClearDebug={onClearDebug} />
        </div>
      )}
    </>
  );
}
