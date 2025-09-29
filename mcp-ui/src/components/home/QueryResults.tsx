"use client";

import { useMemo, useState } from "react";
import { DataChart, DataTable } from "..";
import { extractRows } from "../../utils/format";
import { PlannerSummary, ToolCallInfo } from "../../types/home";

export function ExecutionResultCard({
  result,
  loading,
  strategy,
  toolCall,
}: {
  result: unknown;
  loading?: boolean;
  strategy?: "tool" | "sql" | null;
  toolCall?: ToolCallInfo | null;
}) {
  const [tab, setTab] = useState<"table" | "chart" | "json">("table");
  const rows = useMemo(() => extractRows(result), [result]);
  const title =
    strategy === "tool"
      ? `Tool Result${toolCall?.name ? ` • ${toolCall.name}` : ""}`
      : "SQL Execution Result";
  const hasArgs =
    toolCall?.arguments &&
    typeof toolCall.arguments === "object" &&
    toolCall.arguments !== null &&
    Object.keys(toolCall.arguments).length > 0;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-white/70 dark:bg-zinc-900/50 shadow md:col-span-2">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{title}</h2>
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
            onClick={() => setTab("chart")}
            className={`px-2 py-1 rounded ${
              tab === "chart"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 dark:bg-gray-800"
            }`}
            disabled={rows.length === 0}
          >
            Chart
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
      {strategy === "tool" && (
        <div className="mt-3 text-xs text-zinc-400 space-y-2">
          {toolCall?.reason && <p>{toolCall.reason}</p>}
          {hasArgs && (
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3 text-[11px] text-zinc-300">
              <div className="mb-1 text-zinc-400 uppercase tracking-wide text-[10px]">
                Tool Arguments
              </div>
              <pre className="whitespace-pre-wrap break-words">
                {JSON.stringify(toolCall.arguments, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-gray-500">Loading...</div>
        ) : tab === "table" ? (
          rows.length > 0 ? (
            <DataTable rows={rows} />
          ) : (
            <div className="text-xs text-gray-500">No table data to display</div>
          )
        ) : tab === "chart" ? (
          <DataChart rows={rows} />
        ) : (
          <pre className="text-xs whitespace-pre-wrap break-words">
            {JSON.stringify(result ?? {}, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export function SqlCard({
  sql,
  loading,
  schemaSource,
  schemaSourceLabelValue,
}: {
  sql: string;
  loading?: boolean;
  schemaSource?: string | null;
  schemaSourceLabelValue: (source: string) => string;
}) {
  const showSource = schemaSource && schemaSource !== "none";
  const sourceLabel = showSource ? schemaSourceLabelValue(schemaSource) : null;
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
        <div className="text-xs text-blue-200 mb-2">Schema source: {sourceLabel}</div>
      )}
      <pre className="bg-blue-900/30 border border-blue-700/40 rounded p-3 text-xs whitespace-pre-wrap break-words text-blue-100">
        {sql}
      </pre>
    </div>
  );
}

export function ModelOutputCard({ output }: { output: string }) {
  return (
    <div className="rounded-2xl border border-purple-500/30 bg-purple-600/10 p-4 shadow-md">
      <h2 className="text-sm font-semibold text-purple-100 mb-2">Model Output</h2>
      <pre className="bg-purple-900/30 border border-purple-700/40 rounded p-3 text-xs whitespace-pre-wrap break-words text-purple-100">
        {output}
      </pre>
    </div>
  );
}

export function PlannerSummaryCard({
  planner,
  debugData,
}: {
  planner: PlannerSummary;
  debugData: unknown;
}) {
  const pretty = useMemo(
    () =>
      debugData
        ? JSON.stringify(debugData, null, 2)
        : planner
        ? JSON.stringify(planner, null, 2)
        : null,
    [planner, debugData]
  );

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-600/10 p-4 shadow-md">
      <h2 className="text-sm font-semibold text-emerald-100">Planner Decision</h2>
      <div className="mt-2 text-xs text-emerald-200 space-y-1">
        <div>
          Decision: <strong>{planner.decision || "unknown"}</strong>
        </div>
        {planner.reason && <div>Reason: {planner.reason}</div>}
        {planner.tool?.name && <div>Tool: {planner.tool.name}</div>}
      </div>
      {pretty && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-blue-300/80">
            Debug details
          </summary>
          <pre className="mt-2 text-[11px] text-blue-200 whitespace-pre-wrap break-words bg-blue-900/40 border border-blue-900/60 rounded p-2">
            {pretty}
          </pre>
        </details>
      )}
    </div>
  );
}
