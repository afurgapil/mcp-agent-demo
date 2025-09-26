"use client";

import { schemaSourceLabel } from "../../utils/format";
import DebugJsonCard from "../DebugJsonCard";
import { DebugPayload } from "../../types/home";

export default function DebugPanel({
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
