"use client";

import { useEffect, useState } from "react";
import { AppConfig } from "../../types/home";

export default function ConfigurationPanel({
  config,
  loading,
  error,
  onSave,
  onSyncEmbedding,
  syncingEmbedding,
}: {
  config: AppConfig | null;
  loading: boolean;
  error: string | null;
  onSave: (config: {
    system_prompt?: string;
    schema?: string;
    toolset?: {
      enabled?: boolean;
      name?: string;
    };
  }) => Promise<boolean>;
  onSyncEmbedding: () => void | Promise<void>;
  syncingEmbedding: boolean;
}) {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [schema, setSchema] = useState("");
  const [toolsetName, setToolsetName] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (config) {
      setSystemPrompt(config.system_prompt);
      setSchema(config.schema);
      setToolsetName(config.toolset?.name || "");
      setHasChanges(false);
    }
  }, [config]);

  useEffect(() => {
    if (!config) return;
    const hasDiff =
      systemPrompt !== config.system_prompt ||
      schema !== config.schema ||
      toolsetName !== (config.toolset?.name || "");
    setHasChanges(hasDiff);
  }, [config, systemPrompt, schema, toolsetName]);

  const handleReset = () => {
    if (config) {
      setSystemPrompt(config.system_prompt);
      setSchema(config.schema);
      setToolsetName(config.toolset?.name || "");
      setHasChanges(false);
    }
  };

  const handleSave = async () => {
    const updates: Parameters<typeof onSave>[0] = {};
    if (!config || systemPrompt !== config.system_prompt) {
      updates.system_prompt = systemPrompt;
    }
    if (!config || schema !== config.schema) {
      updates.schema = schema;
    }
    if (!config || toolsetName !== (config.toolset?.name || "")) {
      updates.toolset = {
        enabled: true,
        name: toolsetName,
      };
    }

    if (Object.keys(updates).length > 0) {
      const success = await onSave(updates);
      if (success) {
        setHasChanges(false);
      }
    }
  };

  return (
    <div className="bg-zinc-900/30 backdrop-blur-xl rounded-3xl p-4 md:p-8 border border-zinc-800/50 shadow-2xl">
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 text-red-300 p-3 text-sm mb-4">
          Error: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
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
            System instructions provided to the AI model. It follows these rules when generating SQL queries.
          </p>
        </div>

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
            Default database schema. The AI uses this schema to generate SQL queries.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-zinc-100">Toolset & Embedding</h3>
            <p className="text-xs text-zinc-400 mt-1">
              When toolset mode is enabled, requests are handled with MCP tools first.
              The embedding service must be running for this to work.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-zinc-100">
              Toolset Name (optional)
            </label>
            <input
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 p-3 text-sm focus:outline-none shadow-sm"
              placeholder="e.g., readonly, admin"
              value={toolsetName}
              onChange={(e) => setToolsetName(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="text-xs text-zinc-400">
            {config?.embedding?.url ? (
              <p>
                Embedding service: {config.embedding.url}
                {config.embedding.status ? (
                  <span className="text-emerald-300 ml-2">Connection successful.</span>
                ) : (
                  <span className="text-amber-300 ml-2">Service unreachable. Required for toolset mode.</span>
                )}
              </p>
            ) : (
              <p className="text-amber-300">
                EMBED_LLM_URL is not defined. Toolset mode will not work.
              </p>
            )}
            {config?.embedding?.status && (
              <p className="mt-1 text-zinc-400">
                Model: {config.embedding.status.model || "unknown"} • Tool count: {config.embedding.status.count ?? "?"} • Updated: {config.embedding.status.generatedAt ? new Date(String(config.embedding.status.generatedAt)).toLocaleString() : "unknown"}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-3 pt-4 border-t border-zinc-800">
        <button
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60 shadow hover:brightness-110 transition"
          disabled={loading || !hasChanges}
        >
          {loading ? "Saving..." : "Save Changes"}
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900 transition"
          disabled={loading || !hasChanges}
        >
          Reset Changes
        </button>
        <button
          onClick={onSyncEmbedding}
          className="px-4 py-2 rounded-lg border border-blue-700 text-sm text-blue-200 hover:bg-blue-950 transition disabled:opacity-60"
          disabled={loading || syncingEmbedding || !config?.embedding?.url}
        >
          {syncingEmbedding ? "Syncing..." : "Sync Embedding Service"}
        </button>
        <div className="flex-1" />
        {hasChanges && (
          <span className="text-xs text-amber-400 self-center">There are unsaved changes</span>
        )}
      </div>
    </div>
  );
}
