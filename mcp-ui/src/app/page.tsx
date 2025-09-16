"use client";

import { useMemo, useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";

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
  const t = useTranslations();
  if (!rows || rows.length === 0) return null;
  const cols = Array.from(new Set(rows.flatMap((o) => Object.keys(o))));
  const limited = rows.slice(0, 50);
  return (
    <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-lg mt-2 shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300">
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
              className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50/60 dark:hover:bg-gray-900/60 transition"
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
          {t("table.showing", { shown: limited.length, total: rows.length })}
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

function ThemeToggle() {
  const t = useTranslations();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const ls = localStorage.getItem("theme");
      const prefersDark =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      const initial = ls
        ? ls === "dark"
          ? "dark"
          : "light"
        : prefersDark
        ? "dark"
        : "light";
      setTheme(initial);
    } catch {
      // ignore
    }
  }, []);

  function applyTheme(next: "light" | "dark") {
    const root = document.documentElement;
    const reduceMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion) root.classList.add("theme-animating");
    if (next === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      // ignore
    }
    setTheme(next);
    if (!reduceMotion) {
      window.setTimeout(() => root.classList.remove("theme-animating"), 260);
    }
  }

  const toggled = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => applyTheme(toggled)}
      aria-label="Toggle theme"
      className="px-2 py-1 h-8 rounded-lg border border-gray-300 dark:border-gray-700 text-sm bg-white/60 dark:bg-zinc-900/60 hover:bg-gray-50/60 dark:hover:bg-zinc-900/80 inline-flex items-center gap-2"
      title={
        theme === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")
      }
    >
      <span className="text-base" aria-hidden>
        {theme === "dark" ? "🌞" : "🌙"}
      </span>
      <span className="text-xs text-gray-600 dark:text-gray-300">
        {theme === "dark" ? t("theme.light") : t("theme.dark")}
      </span>
    </button>
  );
}

function LanguageSwitcher() {
  const locale = useLocale() as "en" | "tr" | "de";
  const languages = [
    { code: "tr", label: "🇹🇷" },
    { code: "en", label: "🇺🇸" },
    { code: "de", label: "🇩🇪" },
  ] as const;

  function changeLanguage(code: "en" | "tr" | "de") {
    try {
      document.cookie = `locale=${code}; path=/; max-age=${60 * 60 * 24 * 365}`;
      window.location.reload();
    } catch {
      // ignore
    }
  }

  return (
    <div>
      <select
        aria-label="Select language"
        className="px-2 py-1 h-8 rounded-lg border border-gray-300 dark:border-gray-700 text-sm bg-white/60 dark:bg-zinc-900/60 hover:bg-gray-50/60 dark:hover:bg-zinc-900/80"
        value={locale}
        onChange={(e) => changeLanguage(e.target.value as "en" | "tr" | "de")}
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label} {lang.code.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function Home() {
  const t = useTranslations();
  const currentLocale = useLocale() as "en" | "tr" | "de";
  const [query, setQuery] = useState("");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
          "Accept-Language": currentLocale,
        },
        body: JSON.stringify({ query, locale: currentLocale }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      setPlan(data.plan ?? null);
      setExecSteps(Array.isArray(data.steps) ? data.steps : []);
      setSummary(data.summary ?? null);
      setRaw(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "İstek başarısız oldu");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen page-bg-transition bg-gradient-to-b from-white to-gray-50 dark:from-black dark:to-zinc-950 text-black dark:text-white">
      <div className="max-w-5xl mx-auto p-6">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-sm text-gray-500">{t("subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <LanguageSwitcher />
            <span
              className={`text-xs px-3 h-8 inline-flex items-center rounded-lg ${
                loading
                  ? "bg-amber-100 text-amber-700"
                  : hasResults
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {loading
                ? t("status.working")
                : hasResults
                ? t("status.ready")
                : t("status.idle")}
            </span>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            className="w-full h-32 rounded-xl border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-zinc-900/60 p-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/30 shadow-sm"
            placeholder={t("form.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex gap-3">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm disabled:opacity-60 shadow hover:brightness-105"
              disabled={loading || !query.trim()}
            >
              {loading ? t("form.sending") : t("form.send")}
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-50/60 dark:hover:bg-zinc-900/60"
              onClick={() => {
                setQuery("");
                setError(null);
                setPlan(null);
                setSummary(null);
                setRaw(null);
                setExecSteps([]);
              }}
            >
              {t("form.clear")}
            </button>
          </div>
        </form>

        {/* Primary Result right under input */}
        {(finalResult || summary) && (
          <ResultCard
            result={finalResult}
            summary={summary || undefined}
            loading={loading}
          />
        )}

        <div className="mt-6 grid grid-cols-1  gap-4">
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 text-red-700 p-3 text-sm md:col-span-2">
              Error: {error}
            </div>
          )}
          {plan && (
            <div className="rounded-xl w-full border border-gray-200 dark:border-gray-800 p-0 bg-white/60 dark:bg-zinc-900/40 shadow-sm">
              <header className="flex items-center justify-between px-4 py-3">
                <h2 className="font-medium">{t("plan.title")}</h2>
                <button
                  onClick={() => setOpenPlan((v) => !v)}
                  className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800"
                >
                  {openPlan ? t("plan.hide") : t("plan.show")}
                </button>
              </header>
              {openPlan && (
                <div className="px-4 pb-4">
                  {Array.isArray(plan.steps) && plan.steps.length > 0 ? (
                    <PlanRoadmap steps={plan.steps} />
                  ) : (
                    <div className="rounded bg-gray-50 dark:bg-gray-900 p-2 text-sm">
                      {t("plan.single")}
                    </div>
                  )}
                  {plan.rationale && (
                    <div className="mt-3 text-sm">
                      <span className="font-semibold">
                        {t("plan.rationale")}
                      </span>{" "}
                      {plan.rationale}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {execSteps.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-0 bg-white/60 dark:bg-zinc-900/40 shadow-sm md:col-span-2">
              <header className="flex items-center justify-between px-4 py-3">
                <h2 className="font-medium">{t("steps.title")}</h2>
                <button
                  onClick={() => setOpenSteps((v) => !v)}
                  className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800"
                >
                  {openSteps ? t("steps.hide") : t("steps.show")}
                </button>
              </header>
              {openSteps && <StepTimeline steps={execSteps} />}
            </div>
          )}
          {summary && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white/60 dark:bg-zinc-900/40 shadow-sm md:col-span-2">
              <h2 className="font-medium mb-2">{t("summary.title")}</h2>
              <p className="text-sm whitespace-pre-wrap">{summary}</p>
            </div>
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
  const t = useTranslations();
  const [tab, setTab] = useState<"table" | "json">("table");
  const rows = useMemo(() => extractRows(result), [result]);
  return (
    <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-white/70 dark:bg-zinc-900/50 shadow">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{t("result.title")}</h2>
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setTab("table")}
            className={`px-2 py-1 rounded ${
              tab === "table"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 dark:bg-gray-800"
            }`}
          >
            {t("result.table")}
          </button>
          <button
            onClick={() => setTab("json")}
            className={`px-2 py-1 rounded ${
              tab === "json"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 dark:bg-gray-800"
            }`}
          >
            {t("result.json")}
          </button>
        </div>
      </div>
      {summary && (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          {summary}
        </p>
      )}
      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-gray-500">{t("common.loading")}</div>
        ) : tab === "table" ? (
          rows.length > 0 ? (
            <DataTable rows={rows} />
          ) : (
            <div className="text-xs text-gray-500">{t("result.noTable")}</div>
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
  const t = useTranslations();
  return (
    <div className="px-4 pb-4">
      <h3 className="font-medium mb-2">{t("common.timeline")}</h3>
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
                  {t("common.step")} {st.index + 1}:{" "}
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
                  {st.error ? t("common.error") : t("common.success")}
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
  const t = useTranslations();
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
          {t("result.table")}
        </button>
        <button
          onClick={() => setTab("json")}
          className={`px-2 py-1 rounded ${
            tab === "json"
              ? "bg-blue-600 text-white"
              : "bg-gray-200 dark:bg-gray-800"
          }`}
        >
          {t("result.json")}
        </button>
        <button
          onClick={() =>
            navigator.clipboard?.writeText(JSON.stringify(result, null, 2))
          }
          className="ml-auto px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:brightness-105"
        >
          {t("common.copy")}
        </button>
      </div>
      <div className="mt-2">
        {tab === "table" ? (
          hasRows ? (
            <DataTable rows={rows} />
          ) : (
            <div className="text-xs text-gray-500">{t("result.noTable")}</div>
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
