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
  // Results are shown in a modal immediately; no list-level cache needed for now
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [resultModalTitle, setResultModalTitle] = useState<string>("");
  const [resultModalData, setResultModalData] = useState<unknown>(null);

  useEffect(() => {
    load();
  }, []);

  // Auto-hide toast for run errors
  useEffect(() => {
    if (!runError) return;
    const t = setTimeout(() => setRunError(null), 3000);
    return () => clearTimeout(t);
  }, [runError]);

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

  const grouped = useMemo(() => {
    const m = new Map<string, SavedPrompt[]>();
    for (const p of filtered) {
      const key = p.category || "Genel";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    // sort items by createdAt desc inside each group
    for (const [, arr] of m) {
      arr.sort(
        (a, b) =>
          (b.createdAt ? new Date(b.createdAt).getTime() : 0) -
          (a.createdAt ? new Date(a.createdAt).getTime() : 0)
      );
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function toggle(cat: string) {
    setExpanded((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }

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
      setResultModalTitle(p.title);
      setResultModalData(result);
      setResultModalOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Çalıştırılamadı";
      setRunError(message);
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div className="mt-6 relative">
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
        <div className="space-y-3">
          {grouped.map(([category, items]) => {
            const isOpen = !!expanded[category];
            return (
              <div
                key={category}
                className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40"
              >
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-200 hover:bg-zinc-900/60 rounded-2xl"
                  onClick={() => toggle(category)}
                >
                  <span className="font-medium">{category}</span>
                  <span className="text-xs text-zinc-400">{items.length}</span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                    {items.map((p) => {
                      const id =
                        p._id || `${p.title}-${p.createdAt}` || p.title;
                      // modal üzerinden gösterdiğimiz için kart içinde sonucu rendere etmiyoruz
                      return (
                        <div
                          key={id}
                          className="rounded-md border border-zinc-800/60 bg-zinc-900/60 p-2 hover:bg-zinc-900/70 transition-colors"
                          title={p.sql ? p.sql.slice(0, 200) : undefined}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <div
                              className="text-xs text-zinc-100 truncate"
                              title={p.title}
                            >
                              {p.title}
                            </div>
                            <div className="flex items-center gap-2">
                              {p.createdAt && (
                                <div className="text-[10px] text-zinc-500">
                                  {new Date(p.createdAt).toLocaleDateString()}
                                </div>
                              )}
                              <button
                                className="text-[10px] px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-200 border border-emerald-600/40 hover:bg-emerald-600/30 disabled:opacity-60"
                                onClick={() => rerun(p)}
                                disabled={runningId !== null}
                              >
                                {runningId === id ? "Çalışıyor..." : "Çalıştır"}
                              </button>
                            </div>
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-400 line-clamp-1">
                            {p.prompt}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Result Modal */}
      {resultModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setResultModalOpen(false)}
          ></div>
          <div className="relative max-w-5xl w-[96vw] max-h-[80vh] overflow-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl">
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="text-sm font-semibold text-zinc-200 truncate pr-4">
                {resultModalTitle}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
                  onClick={() => {
                    try {
                      const json = JSON.stringify(
                        resultModalData ?? {},
                        null,
                        2
                      );
                      navigator.clipboard?.writeText(json);
                    } catch {}
                  }}
                >
                  Copy JSON
                </button>
                <button
                  className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
                  onClick={() => {
                    try {
                      const rows = extractRows(resultModalData);
                      const csv = (() => {
                        if (!rows || rows.length === 0) return "";
                        const headers = Array.from(
                          new Set(rows.flatMap((o) => Object.keys(o)))
                        );
                        const escape = (v: unknown) => {
                          const s = v == null ? "" : String(v);
                          return /[",\n]/.test(s)
                            ? `"${s.replace(/"/g, '""')}"`
                            : s;
                        };
                        const lines = [headers.join(",")];
                        for (const r of rows) {
                          lines.push(
                            headers
                              .map((h) =>
                                escape((r as Record<string, unknown>)[h])
                              )
                              .join(",")
                          );
                        }
                        return lines.join("\n");
                      })();
                      const blob = new Blob([csv], {
                        type: "text/csv;charset=utf-8;",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "result.csv";
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    } catch {}
                  }}
                >
                  Download CSV
                </button>
                <button
                  className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  onClick={() => setResultModalOpen(false)}
                >
                  Kapat
                </button>
              </div>
            </div>
            <ResultViewer result={resultModalData} />
          </div>
        </div>
      )}

      {/* Toast for run errors */}
      {runError && (
        <div className="fixed right-6 bottom-6 z-50">
          <div className="px-4 py-3 rounded-lg border border-red-600/40 bg-red-900/80 text-red-100 text-sm shadow-lg">
            {runError}
          </div>
        </div>
      )}
    </div>
  );
}
