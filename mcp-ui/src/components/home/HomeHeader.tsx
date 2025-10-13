"use client";

export default function HomeHeader({
  model,
  onModelChange,
  debugMode,
  onToggleDebug,
  useRagHints,
  onToggleRagHints,
  useToolset,
  onToggleToolset,

  companyName,
  branchName,
}: {
  model: string;
  onModelChange: (value: string) => void;
  debugMode: boolean;
  onToggleDebug: () => void;
  useRagHints: boolean;
  onToggleRagHints: () => void;
  useToolset: boolean;
  onToggleToolset: () => void;
  activeTab: "chat" | "query" | "tools" | "history" | "insert";
  onTabChange: (tab: "chat" | "query" | "tools" | "history" | "insert") => void;
  companyName?: string | null;
  branchName?: string | null;
}) {
  return (
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
          <button
            onClick={onToggleRagHints}
            className={`px-3 py-2 rounded-lg text-sm border transition ${
              useRagHints
                ? "bg-green-500/10 text-green-200 border-green-500/30"
                : "bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:bg-zinc-900/70"
            }`}
            title="Toggle RAG hints in SQL generation"
          >
            RAG Hints: {useRagHints ? "On" : "Off"}
          </button>
          <button
            onClick={onToggleToolset}
            className={`px-3 py-2 rounded-lg text-sm border transition ${
              useToolset
                ? "bg-indigo-500/10 text-indigo-200 border-indigo-500/30"
                : "bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:bg-zinc-900/70"
            }`}
            title="Toggle Toolset planner usage"
          >
            Toolset: {useToolset ? "On" : "Off"}
          </button>
          {(companyName || branchName) && (
            <div className="text-xs px-3 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/50 text-zinc-300">
              <span>{companyName || "Firma"}</span>
              {branchName ? <span className="mx-1">/</span> : null}
              <span>{branchName || null}</span>
            </div>
          )}
          <select
            className="text-xs px-3 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/50 text-zinc-200"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            title="Model"
            data-testid="model-select"
          >
            <option value="">Default</option>
            <option value="deepseek-chat">deepseek-chat</option>
            <option value="deepseek-reasoner">deepseek-reasoner</option>
            <option value="gemini-1.5-pro">gemini-1.5-pro</option>
            <option value="custom">Custom</option>
          </select>
          <button
            onClick={onToggleDebug}
            className={`text-xs px-4 py-2 inline-flex items-center rounded-xl transition-all duration-300 transform hover:scale-105 ${
              debugMode
                ? "bg-gradient-to-r from-blue-500/20 to-blue-600/20 text-blue-300 border border-blue-500/30 shadow-lg shadow-blue-500/20"
                : "bg-zinc-800/50 backdrop-blur-sm text-zinc-300 hover:bg-zinc-700/50 border border-zinc-700/50"
            }`}
          >
            <span className="flex items-center gap-2">
              {debugMode ? "🟢 Debug On" : "⚪ Debug Off"}
            </span>
          </button>
          <a
            href="/logout"
            className="text-xs px-4 py-2 rounded-xl bg-red-600/90 hover:bg-red-500 border border-red-500/60 text-white"
          >
            Logout
          </a>
        </div>
      </div>

      {/* Tab buttons moved to left sidebar */}
    </header>
  );
}
