"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchPrompts, type SavedPrompt, callTool } from "../../services/api";
import { DataTable, DataChart } from "..";
import { extractRows } from "../../utils/format";

function ResultViewer({ result }: { result: unknown }) {
  const [tab, setTab] = useState<"table" | "chart" | "json">("table");
  const rows = useMemo(() => extractRows(result), [result]);
  return (
    <div className="mt-3">
      <div className="flex gap-2 text-xs">
        <button
          onClick={() => setTab("table")}
          className={`px-2 py-1 rounded ${
            tab === "table" ? "bg-emerald-600 text-white" : "bg-zinc-800"
          }`}
        >
          Table
        </button>
        <button
          onClick={() => setTab("chart")}
          className={`px-2 py-1 rounded ${
            tab === "chart" ? "bg-emerald-600 text-white" : "bg-zinc-800"
          }`}
          disabled={rows.length === 0}
        >
          Chart
        </button>
        <button
          onClick={() => setTab("json")}
          className={`px-2 py-1 rounded ${
            tab === "json" ? "bg-emerald-600 text-white" : "bg-zinc-800"
          }`}
        >
          JSON
        </button>
      </div>
      <div className="mt-2">
        {tab === "table" ? (
          rows.length > 0 ? (
            <DataTable rows={rows} />
          ) : (
            <div className="text-xs text-zinc-500">No table data</div>
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

export default function SavedPrompts() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [query, setQuery] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<Record<string, unknown>>({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPrompts();
      setPrompts(data.prompts);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.prompt.toLowerCase().includes(q)
    );
  }, [prompts, query]);

  async function rerun(p: SavedPrompt) {
    const id = p._id || `${p.title}-${p.createdAt}` || p.title;
    setRunningId(id);
    setRunError(null);
    try {
      if (!p.sql || !p.sql.trim()) {
        throw new Error("Bu kayıtta SQL yok");
      }
      let result: unknown = null;
      try {
        const exec = await callTool("mysql_execute_sql", { sql: p.sql });
        result = exec?.result ?? null;
      } catch {
        // Fallback to mysql_execute if execute_sql is unavailable
        const exec = await callTool("mysql_execute", { sql: p.sql });
        result = exec?.result ?? null;
      }
      setRunResult((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Çalıştırılamadı";
      setRunError(message);
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center gap-3">
        <input
          className="flex-1 rounded-xl bg-zinc-900/60 border border-zinc-800/60 p-3 text-sm text-zinc-200"
          placeholder="Ara..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={load}
          className="px-4 py-2 rounded-xl bg-zinc-800/60 border border-zinc-700/60 text-zinc-200"
        >
          Yenile
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 text-red-300 p-3 text-sm">
          Hata: {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-400">Yükleniyor...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-zinc-400">Kayıt bulunamadı</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((p) => (
            <div
              key={p._id || `${p.title}-${p.createdAt}`}
              className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">
                    {p.title}
                  </div>
                  <div className="text-xs text-zinc-400">{p.category}</div>
                </div>
                <div className="flex items-center gap-2">
                  {p.createdAt && (
                    <div className="text-[10px] text-zinc-500">
                      {new Date(p.createdAt).toLocaleString()}
                    </div>
                  )}
                  <button
                    className="text-xs px-3 py-1 rounded-lg bg-emerald-600/20 text-emerald-200 border border-emerald-600/40 hover:bg-emerald-600/30 disabled:opacity-60"
                    onClick={() => rerun(p)}
                    disabled={runningId !== null}
                  >
                    {runningId ===
                    (p._id || `${p.title}-${p.createdAt}` || p.title)
                      ? "Çalışıyor..."
                      : "Tekrar Çalıştır"}
                  </button>
                </div>
              </div>
              <div className="text-xs text-zinc-300 whitespace-pre-wrap break-words">
                {p.prompt}
              </div>
              {(p.sql || p.modelOutput) && (
                <details className="mt-2">
                  <summary className="text-xs text-blue-300 cursor-pointer">
                    Detaylar
                  </summary>
                  {p.sql && (
                    <pre className="mt-2 text-[11px] whitespace-pre-wrap break-words bg-blue-900/20 border border-blue-700/40 rounded p-2 text-blue-100">
                      {p.sql}
                    </pre>
                  )}
                  {p.modelOutput && (
                    <pre className="mt-2 text-[11px] whitespace-pre-wrap break-words bg-purple-900/20 border border-purple-700/40 rounded p-2 text-purple-100">
                      {p.modelOutput}
                    </pre>
                  )}
                </details>
              )}
              {runError && (
                <div className="mt-2 text-xs text-red-400">
                  Hata: {runError}
                </div>
              )}
              {(() => {
                const id = p._id || `${p.title}-${p.createdAt}` || p.title;
                const result = runResult[id];
                if (result === undefined) return null;
                return <ResultViewer result={result} />;
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
