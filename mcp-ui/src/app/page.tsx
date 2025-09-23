"use client";

import { useMemo, useState, useEffect } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Step = { tool: string; args?: Record<string, unknown> };
type Plan = { steps?: Step[]; rationale?: string } & Partial<Step>;
type StepResult = {
  index: number;
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

type MCPResult = {
  content?: Array<{ text?: string }>;
  rows?: Array<Record<string, unknown>>;
  // Allow extra properties without using any
  [key: string]: unknown;
};

// Extract row objects from a typical MCP result
function extractRows(result: unknown): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  if (!result || typeof result !== "object") return rows;
  const r = result as MCPResult;
  // Common pattern: content: [{ type: 'text', text: '{"k":"v"}' }, ...]
  if (Array.isArray(r.content)) {
    for (const item of r.content) {
      const txt = item?.text;
      if (typeof txt === "string") {
        try {
          const obj = JSON.parse(txt);
          if (obj && typeof obj === "object") rows.push(obj);
        } catch {
          // ignore non-JSON lines
        }
      }
    }
  }
  // Fallbacks: some tools may return direct arrays/rows
  if (Array.isArray(r.rows)) {
    for (const obj of r.rows) {
      if (obj && typeof obj === "object")
        rows.push(obj as Record<string, unknown>);
    }
  }
  return rows;
}

function DataTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows || rows.length === 0) return null;
  const cols = Array.from(new Set(rows.flatMap((o) => Object.keys(o))));
  const limited = rows.slice(0, 50);
  return (
    <div className="overflow-x-auto border border-zinc-800 rounded-lg mt-2 shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-900 text-gray-300">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {limited.map((row, i) => (
            <tr
              key={i}
              className="border-t border-zinc-800 hover:bg-zinc-900/60 transition"
            >
              {cols.map((c) => (
                <td
                  key={c}
                  className="px-3 py-2 align-top whitespace-pre-wrap break-words"
                >
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limited.length && (
        <div className="px-3 py-2 text-xs text-gray-500">
          Showing first {limited.length} rows of {rows.length}
        </div>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// Debug panel types
type DebugInfo = {
  originalQuery?: string;
  processedQuery?: string;
  thinkingModelInput?: Record<string, unknown>;
  thinkingModelOutput?: string;
  nlToSqlInput?: Record<string, unknown>;
  nlToSqlOutput?: string;
  stages?: Record<string, string>;
  executionResult?: unknown;
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [customSchema, setCustomSchema] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [execSteps, setExecSteps] = useState<StepResult[]>([]);
  const [raw, setRaw] = useState<unknown>(null);
  const hasResults = useMemo(
    () => !!summary || execSteps.length > 0 || !!plan,
    [summary, execSteps, plan]
  );
  const finalStep = execSteps.length ? execSteps[execSteps.length - 1] : null;
  const finalResult = finalStep?.result;
  const [openPlan, setOpenPlan] = useState(true);
  const [openSteps, setOpenSteps] = useState(true);

  // Debug panel state
  const [debugMode, setDebugMode] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  // Configuration state
  const [activeTab, setActiveTab] = useState<"query" | "config">("query");
  const [config, setConfig] = useState<{
    system_prompt: string;
    schema: string;
  } | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Load configuration on component mount
  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/api/config`);
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      } else {
        throw new Error("Configuration yüklenemedi");
      }
    } catch (err: unknown) {
      setConfigError(
        err instanceof Error ? err.message : "Configuration yükleme hatası"
      );
    } finally {
      setConfigLoading(false);
    }
  }

  async function saveConfig(newConfig: {
    system_prompt?: string;
    schema?: string;
  }) {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/api/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newConfig),
      });

      if (res.ok) {
        // Reload config to get updated values
        await loadConfig();
        return true;
      } else {
        const errorData = await res.json();
        throw new Error(
          errorData?.detail?.[0]?.msg || "Configuration kaydetme hatası"
        );
      }
    } catch (err: unknown) {
      setConfigError(
        err instanceof Error ? err.message : "Configuration kaydetme hatası"
      );
      return false;
    } finally {
      setConfigLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Validation: query must be provided
    if (!query.trim()) {
      setError("Lütfen sorgu girin");
      return;
    }

    setLoading(true);
    setError(null);
    setPlan(null);
    setSummary(null);
    setRaw(null);
    setExecSteps([]);
    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/nl`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          customSchema: customSchema,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      setPlan(data.plan ?? null);
      setExecSteps(Array.isArray(data.steps) ? data.steps : []);
      setSummary(data.summary ?? null);
      setRaw(data);

      // Extract debug information from response
      setDebugInfo({
        originalQuery: data.originalQuery,
        processedQuery: data.processedQuery,
        thinkingModelInput: { message: query, max_tokens: 300 },
        thinkingModelOutput: data.processedQuery,
        nlToSqlInput: {
          question: data.processedQuery,
          schema: customSchema || "default schema",
        },
        nlToSqlOutput: data.sql,
        stages: data.stages,
        executionResult: data.executionResult,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "İstek başarısız oldu");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto p-6">
        <header className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">MCP UI</h1>
              <p className="text-sm text-gray-400">
                From natural language to MCP Toolbox tools
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDebugMode(!debugMode)}
                className={`text-xs px-3 h-8 inline-flex items-center rounded-lg transition-colors ${
                  debugMode
                    ? "bg-blue-900/40 text-blue-300 border border-blue-700"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                🔍 Debug {debugMode ? "ON" : "OFF"}
              </button>
              <span
                className={`text-xs px-3 h-8 inline-flex items-center rounded-lg ${
                  loading || configLoading
                    ? "bg-amber-900/40 text-amber-300"
                    : hasResults
                    ? "bg-emerald-900/40 text-emerald-300"
                    : "bg-zinc-800 text-zinc-300"
                }`}
              >
                {loading || configLoading
                  ? "Çalışıyor"
                  : hasResults
                  ? "Hazır"
                  : "Boşta"}
              </span>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
            <button
              onClick={() => setActiveTab("query")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "query"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-300 hover:text-white hover:bg-zinc-800"
              }`}
            >
              📝 SQL Sorgu
            </button>
            <button
              onClick={() => setActiveTab("config")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "config"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-300 hover:text-white hover:bg-zinc-800"
              }`}
            >
              ⚙️ Konfigürasyon
            </button>
          </div>
        </header>

        {/* Query Tab Content */}
        {activeTab === "query" && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-100">
                  Sorgu
                </label>
                <textarea
                  className="w-full h-32 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 p-3 text-sm focus:outline-none shadow-sm"
                  placeholder={
                    "örn., Son 30 gün içinde alışveriş yapan müşteriler kimler?"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-100">
                  Veritabanı Şeması (Opsiyonel)
                </label>
                <textarea
                  className="w-full h-32 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 p-3 text-sm focus:outline-none shadow-sm font-mono"
                  placeholder={`Özel şema girin veya boş bırakın (varsayılan şema kullanılacak)

CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT
);`}
                  value={customSchema}
                  onChange={(e) => setCustomSchema(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60 shadow hover:brightness-110"
                disabled={loading || !query.trim()}
              >
                {loading ? "Gönderiliyor..." : "Gönder"}
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
                onClick={() => {
                  setQuery("");
                  setCustomSchema("");
                  setError(null);
                  setPlan(null);
                  setSummary(null);
                  setRaw(null);
                  setExecSteps([]);
                }}
              >
                Temizle
              </button>
            </div>
          </form>
        )}

        {/* Configuration Tab Content */}
        {activeTab === "config" && (
          <ConfigurationPanel
            config={config}
            loading={configLoading}
            error={configError}
            onSave={saveConfig}
          />
        )}

        {/* Primary Result right under input - only show on query tab */}
        {activeTab === "query" && finalResult ? (
          <ResultCard
            result={finalResult as Record<string, unknown>}
            loading={loading}
          />
        ) : null}

        {/* Results section - only show on query tab */}
        {activeTab === "query" && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {error && (
              <div className="rounded-lg border border-red-800 bg-red-950 text-red-300 p-3 text-sm md:col-span-2">
                Error: {error}
              </div>
            )}
            {false && (
              <div className="rounded-xl w-full border border-gray-200 dark:border-gray-800 p-0 bg-white/60 dark:bg-zinc-900/40 shadow-sm">
                <header className="flex items-center justify-between px-4 py-3">
                  <h2 className="font-medium">Plan</h2>
                  <button
                    onClick={() => setOpenPlan((v) => !v)}
                    className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800"
                  >
                    {openPlan ? "Gizle" : "Göster"}
                  </button>
                </header>
                {openPlan && (
                  <div className="px-4 pb-4">
                    {Array.isArray(plan?.steps) && plan!.steps!.length > 0 ? (
                      <PlanRoadmap steps={plan!.steps as Step[]} />
                    ) : (
                      <div className="rounded bg-gray-50 dark:bg-gray-900 p-2 text-sm">
                        Tek adımlı plan
                      </div>
                    )}
                    {plan?.rationale && (
                      <div className="mt-3 text-sm">
                        <span className="font-semibold">Gerekçe: </span>
                        {plan?.rationale}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {false && (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-0 bg-white/60 dark:bg-zinc-900/40 shadow-sm md:col-span-2">
                <header className="flex items-center justify-between px-4 py-3">
                  <h2 className="font-medium">Adımlar</h2>
                  <button
                    onClick={() => setOpenSteps((v) => !v)}
                    className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800"
                  >
                    {openSteps ? "Gizle" : "Göster"}
                  </button>
                </header>
                {openSteps && <StepTimeline steps={execSteps} />}
              </div>
            )}
            {false && (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white/60 dark:bg-zinc-900/40 shadow-sm md:col-span-2">
                <h2 className="font-medium mb-2">Özet</h2>
                <p className="text-sm whitespace-pre-wrap">{summary}</p>
              </div>
            )}
            {/* AI Raw Response */}
            {raw && (raw as Record<string, unknown>).sql ? (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white/60 dark:bg-zinc-900/40 shadow-sm">
                <h3 className="text-sm font-medium mb-2">
                  AI&apos;dan Gelen Response
                </h3>
                <pre className="bg-gray-50 dark:bg-gray-900 rounded p-2 whitespace-pre-wrap break-words text-xs">
                  {String((raw as Record<string, unknown>).sql)}
                </pre>
              </div>
            ) : null}

            {/* SQL Execution Result */}
            {raw && (raw as Record<string, unknown>).executionResult ? (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white/60 dark:bg-zinc-900/40 shadow-sm">
                <h3 className="text-sm font-medium mb-2">
                  SQL Execution Result
                </h3>
                <pre className="bg-gray-50 dark:bg-gray-900 rounded p-2 whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(
                    (raw as Record<string, unknown>).executionResult,
                    null,
                    2
                  )}
                </pre>
              </div>
            ) : null}

            {raw != null && (
              <details className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white/60 dark:bg-zinc-900/40 shadow-sm md:col-span-2">
                <summary className="cursor-pointer text-sm">
                  Raw Response
                </summary>
                <pre className="mt-2 bg-gray-50 dark:bg-gray-900 rounded p-2 whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(raw, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Debug Panel - only show on query tab */}
        {activeTab === "query" && debugMode && debugInfo && (
          <div className="mt-6">
            <DebugPanel debugInfo={debugInfo} />
          </div>
        )}
      </div>
      {loading && <LoadingOverlay />}
    </div>
  );
}

function ResultCard({
  result,
  summary,
  loading,
}: {
  result: unknown;
  summary?: string;
  loading?: boolean;
}) {
  const [tab, setTab] = useState<"table" | "json">("table");
  const rows = useMemo(() => extractRows(result), [result]);
  return (
    <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-white/70 dark:bg-zinc-900/50 shadow">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Sonuç</h2>
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setTab("table")}
            className={`px-2 py-1 rounded ${
              tab === "table"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 dark:bg-gray-800"
            }`}
          >
            Tablo
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
      {summary && <p className="mt-2 text-sm text-gray-600">{summary}</p>}
      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-gray-500">Yükleniyor...</div>
        ) : tab === "table" ? (
          rows.length > 0 ? (
            <DataTable rows={rows} />
          ) : (
            <div className="text-xs text-gray-500">
              Gösterilecek tablo verisi yok
            </div>
          )
        ) : (
          <pre className="text-xs whitespace-pre-wrap break-words">
            {JSON.stringify(result ?? {}, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function LoadingOverlay() {
  const phrases = useMemo(
    () => [
      "SELECT * FROM",
      "DESCRIBE table",
      "SHOW TABLES",
      "WHERE id = ?",
      "INSERT INTO",
      "UPDATE ... SET",
      "DELETE WHERE",
      "ORDER BY",
      "GROUP BY",
      "LIMIT 50",
      "JOIN ... ON",
      "VALUES (...)",
      "SET x = y",
      "FROM gateway_data",
    ],
    []
  );
  const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>_-+=[]{}()#%^*";
  const makeRandom = (len: number) =>
    Array.from(
      { length: len },
      () => glyphs[Math.floor(Math.random() * glyphs.length)]
    ).join("");
  const initTiles = () =>
    Array.from({ length: 14 }, (_, i) =>
      i % 3 === 0 ? phrases[i % phrases.length] : makeRandom(8)
    );

  const [tiles, setTiles] = useState<string[]>(initTiles());
  const [active, setActive] = useState<Set<number>>(new Set());

  useEffect(() => {
    const interval = setInterval(() => {
      setTiles((prev) => {
        const next = [...prev];
        // randomly scramble a few tiles
        for (let k = 0; k < 3; k++) {
          const idx = Math.floor(Math.random() * next.length);
          const src = next[idx];
          // sometimes snap to a phrase, otherwise scramble
          if (Math.random() < 0.18) {
            next[idx] = phrases[Math.floor(Math.random() * phrases.length)];
          } else {
            const chars = src.split("");
            const pos = Math.floor(Math.random() * Math.max(4, chars.length));
            if (chars[pos])
              chars[pos] = glyphs[Math.floor(Math.random() * glyphs.length)];
            next[idx] = chars.join("");
          }
        }
        return next;
      });
      setActive(() => {
        const s = new Set<number>();
        // pulse a few tiles as "processed"
        for (let i = 0; i < 4; i++)
          s.add(Math.floor(Math.random() * tiles.length));
        return s;
      });
    }, 180);
    return () => clearInterval(interval);
  }, [phrases, glyphs, tiles.length]);

  return (
    <div
      className="loader-overlay"
      role="status"
      aria-live="polite"
      aria-label="Processing"
    >
      <div className="loader-card">
        <div className="loader-header">
          <span className="loader-badge">MCP</span>
          <div className="loader-title">Model processing your request…</div>
        </div>
        <div className="loader-body">
          <div className="relative flex items-center justify-center">
            <div className="ring">
              <div className="orbit">
                <div className="dot" />
                <div className="dot" />
                <div className="dot" />
              </div>
            </div>
          </div>
          <div>
            <div className="conveyor mb-3" aria-hidden>
              <div className="belt">
                {[...tiles, ...tiles].map((t, i) => (
                  <div
                    key={i}
                    className={`tile ${
                      active.has(i % tiles.length) ? "active" : ""
                    }`}
                  >
                    <code className="tile-text">{t}</code>
                  </div>
                ))}
              </div>
            </div>
            <div className="meta">
              <div className="line" />
              <div className="line" style={{ width: "70%" }} />
              <div className="line" style={{ width: "85%" }} />
            </div>
          </div>
        </div>
        <div className="footer">
          <div>Composing tools and validating steps…</div>
          <div>ETA: indeterminate</div>
        </div>
      </div>
    </div>
  );
}

function StepTimeline({ steps }: { steps: StepResult[] }) {
  return (
    <div className="px-4 pb-4">
      <h3 className="font-medium mb-2">Zaman Çizelgesi</h3>
      <ol className="relative border-l border-gray-200 dark:border-gray-800 ml-2 h-96 overflow-auto pr-2 custom-scroll">
        {steps.map((st) => (
          <li key={st.index} className="ml-4 mb-4">
            <div
              className={`w-2 h-2 rounded-full border -ml-[33px] mt-2 ${
                st.error
                  ? "bg-red-500 border-red-600"
                  : "bg-green-500 border-green-600"
              }`}
            />
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-sm">
                  Adım {st.index + 1}:{" "}
                  <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
                    {st.tool}
                  </span>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    st.error
                      ? "bg-red-100 text-red-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {st.error ? "Hata" : "Başarılı"}
                </span>
              </div>
              {st.args && (
                <pre className="mt-2 text-xs whitespace-pre-wrap break-words max-h-40 overflow-auto custom-scroll">
                  {JSON.stringify(st.args, null, 2)}
                </pre>
              )}
              {st.error ? (
                <div className="mt-2 text-red-600 text-sm">{st.error}</div>
              ) : (
                <StepResultViewer result={st.result} />
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

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
              ? "bg-blue-600 text-white"
              : "bg-gray-200 dark:bg-gray-800"
          }`}
        >
          Tablo
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
        <button
          onClick={() =>
            navigator.clipboard?.writeText(JSON.stringify(result, null, 2))
          }
          className="ml-auto px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:brightness-105"
        >
          Kopyala
        </button>
      </div>
      <div className="mt-2">
        {tab === "table" ? (
          hasRows ? (
            <DataTable rows={rows} />
          ) : (
            <div className="text-xs text-gray-500">
              Gösterilecek tablo verisi yok
            </div>
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

function useColumns() {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const calc = () => {
      const w = typeof window !== "undefined" ? window.innerWidth : 1024;
      if (w < 640) setCols(1);
      else if (w < 768) setCols(2);
      else if (w < 1280) setCols(3);
      else setCols(4);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return cols;
}

function PlanRoadmap({ steps }: { steps: Step[] }) {
  const cols = useColumns();
  const rows: Step[][] = [];
  for (let i = 0; i < steps.length; i += cols)
    rows.push(steps.slice(i, i + cols));
  return (
    <div className="py-2 h-80 overflow-auto pr-2 custom-scroll">
      {rows.map((row, rIdx) => {
        const even = rIdx % 2 === 0; // 0-based: first row L→R, second R→L
        const items = even ? row : [...row].reverse();
        return (
          <div key={rIdx} className="mb-3">
            <div className="flex items-stretch gap-3">
              {items.map((s, i) => (
                <div
                  key={`${rIdx}-${i}`}
                  className="flex items-center gap-3 flex-1 min-w-0"
                >
                  <div className="rounded-lg bg-sky-50 dark:bg-sky-900/30 border border-sky-100 dark:border-sky-800 p-3 shadow-sm w-full">
                    <div className="text-xs text-sky-700 dark:text-sky-300 font-semibold">
                      Step {rIdx * cols + (even ? i + 1 : row.length - i)}
                    </div>
                    <div className="mt-1">
                      <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
                        {s.tool}
                      </span>
                    </div>
                    {s.args && (
                      <pre className="mt-2 text-[11px] whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300 max-h-28 overflow-auto custom-scroll">
                        {JSON.stringify(s.args, null, 2)}
                      </pre>
                    )}
                  </div>
                  {i < items.length - 1 && (
                    <div className="text-gray-400 text-xl select-none">
                      {even ? "→" : "←"}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {rIdx < rows.length - 1 && (
              <div
                className={`flex ${
                  even ? "justify-end" : "justify-start"
                } mt-1`}
              >
                <div className="text-gray-400 select-none">↓</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DebugPanel({ debugInfo }: { debugInfo: DebugInfo | null }) {
  const [activeTab, setActiveTab] = useState<
    "thinking" | "nlToSql" | "stages" | "execution"
  >("thinking");

  if (!debugInfo) return null;

  const tabs = [
    { id: "thinking", label: "Thinking Model", icon: "🧠" },
    { id: "nlToSql", label: "NL to SQL", icon: "🔄" },
    { id: "stages", label: "Stages", icon: "📊" },
    { id: "execution", label: "Execution", icon: "⚡" },
  ] as const;

  return (
    <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🔍</span>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          AI Debug Panel
        </h3>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-1 mb-4 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === "thinking" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                📥 Input (User Query)
              </h4>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded p-3">
                <pre className="text-xs whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300">
                  {debugInfo.originalQuery || "N/A"}
                </pre>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                📤 Output (Processed)
              </h4>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded p-3">
                <pre className="text-xs whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300">
                  {debugInfo.processedQuery || "N/A"}
                </pre>
              </div>
            </div>
          </div>
        )}

        {activeTab === "nlToSql" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                📥 Input (Processed Query)
              </h4>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded p-3">
                <pre className="text-xs whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300">
                  {debugInfo.processedQuery || "N/A"}
                </pre>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                📤 Output (Generated SQL)
              </h4>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded p-3">
                <pre className="text-xs whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300">
                  {debugInfo.nlToSqlOutput || "N/A"}
                </pre>
              </div>
            </div>
          </div>
        )}

        {activeTab === "stages" && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              🔄 Processing Stages
            </h4>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded p-3">
              {debugInfo.stages ? (
                <div className="space-y-2">
                  {Object.entries(debugInfo.stages).map(([stage, status]) => (
                    <div key={stage} className="flex items-center gap-3">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-20">
                        {stage}:
                      </span>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          status === "completed"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : status === "fallback"
                            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {status as string}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-gray-500">
                  No stage information
                </span>
              )}
            </div>
          </div>
        )}

        {activeTab === "execution" && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              ⚡ SQL Execution Result
            </h4>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded p-3">
              <pre className="text-xs whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300 max-h-96 overflow-auto">
                {debugInfo.executionResult
                  ? JSON.stringify(debugInfo.executionResult, null, 2)
                  : "No execution result"}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigurationPanel({
  config,
  loading,
  error,
  onSave,
}: {
  config: { system_prompt: string; schema: string } | null;
  loading: boolean;
  error: string | null;
  onSave: (config: {
    system_prompt?: string;
    schema?: string;
  }) => Promise<boolean>;
}) {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [schema, setSchema] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Update local state when config loads
  useEffect(() => {
    if (config) {
      setSystemPrompt(config.system_prompt);
      setSchema(config.schema);
      setHasChanges(false);
    }
  }, [config]);

  // Track changes
  useEffect(() => {
    if (config) {
      const changed =
        systemPrompt !== config.system_prompt || schema !== config.schema;
      setHasChanges(changed);
    }
  }, [systemPrompt, schema, config]);

  const handleSave = async () => {
    if (!config) return;

    const updates: { system_prompt?: string; schema?: string } = {};
    if (systemPrompt !== config.system_prompt)
      updates.system_prompt = systemPrompt;
    if (schema !== config.schema) updates.schema = schema;

    if (Object.keys(updates).length > 0) {
      const success = await onSave(updates);
      if (success) {
        setHasChanges(false);
      }
    }
  };

  const handleReset = () => {
    if (config) {
      setSystemPrompt(config.system_prompt);
      setSchema(config.schema);
      setHasChanges(false);
    }
  };

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-zinc-400">Configuration yükleniyor...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 text-red-300 p-3 text-sm">
          Hata: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {/* System Prompt */}
        <div>
          <label className="block text-sm font-medium mb-2 text-zinc-100">
            System Prompt
          </label>
          <textarea
            className="w-full h-48 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 p-3 text-sm focus:outline-none shadow-sm font-mono"
            placeholder="AI asistanı için sistem talimatları girin..."
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            disabled={loading}
          />
          <p className="text-xs text-zinc-400 mt-1">
            AI modeline verilen sistem talimatları. SQL sorgusu oluştururken bu
            kurallara uyar.
          </p>
        </div>

        {/* Database Schema */}
        <div>
          <label className="block text-sm font-medium mb-2 text-zinc-100">
            Veritabanı Şeması
          </label>
          <textarea
            className="w-full h-64 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 p-3 text-sm focus:outline-none shadow-sm font-mono"
            placeholder="CREATE TABLE statements ve database schema..."
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            disabled={loading}
          />
          <p className="text-xs text-zinc-400 mt-1">
            Varsayılan veritabanı şeması. AI bu şemayı kullanarak SQL sorguları
            oluşturur.
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4 border-t border-zinc-800">
        <button
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60 shadow hover:brightness-110 transition"
          disabled={loading || !hasChanges}
        >
          {loading ? "Kaydediliyor..." : "Kaydet"}
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900 transition"
          disabled={loading || !hasChanges}
        >
          Sıfırla
        </button>
        <div className="flex-1" />
        {hasChanges && (
          <span className="text-xs text-amber-400 self-center">
            Kaydedilmemiş değişiklikler var
          </span>
        )}
      </div>
    </div>
  );
}
