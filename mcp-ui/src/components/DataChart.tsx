"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  PointElement,
  Tooltip,
  ArcElement,
  LineElement,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar, Line, Pie } from "react-chartjs-2";
import { formatCell, Row } from "../utils/format";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler
);

type ChartType = "bar" | "line" | "pie";

function isNumeric(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n);
  }
  return false;
}

function toNumeric(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isDateLike(value: unknown): boolean {
  if (!value) return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t);
  }
  return false;
}

function distinctCount(values: unknown[], limit = 1000): number {
  const set = new Set<unknown>();
  for (let i = 0; i < values.length && set.size <= limit; i++) {
    set.add(values[i]);
  }
  return set.size;
}

function isIdKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower === "id" ||
    lower.endsWith("_id") ||
    lower.endsWith("id") ||
    lower.includes("uuid")
  );
}

function palette(count: number): string[] {
  const base = [
    "#60a5fa",
    "#34d399",
    "#fbbf24",
    "#f472b6",
    "#a78bfa",
    "#f87171",
    "#38bdf8",
    "#facc15",
    "#4ade80",
    "#c084fc",
  ];
  if (count <= base.length) return base.slice(0, count);
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = i % base.length;
    const shade = 0.85 + (i / count) * 0.15;
    const baseColor = base[idx].replace("#", "");
    const r = parseInt(baseColor.slice(0, 2), 16);
    const g = parseInt(baseColor.slice(2, 4), 16);
    const b = parseInt(baseColor.slice(4, 6), 16);
    const mix = (channel: number) =>
      Math.min(255, Math.max(0, Math.round(channel * shade)));
    colors.push(
      `#${mix(r).toString(16).padStart(2, "0")}${mix(g)
        .toString(16)
        .padStart(2, "0")}${mix(b).toString(16).padStart(2, "0")}`
    );
  }
  return colors;
}

export function DataChart({ rows }: { rows: Row[] }) {
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [labelKey, setLabelKey] = useState<string | null>(null);
  const [valueKeys, setValueKeys] = useState<string[]>([]);

  const columns = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    const keys = new Set<string>();
    for (const row of rows) {
      Object.keys(row).forEach((key) => keys.add(key));
    }
    return Array.from(keys);
  }, [rows]);

  const numericColumns = useMemo(() => {
    return columns.filter(
      (key) => rows.some((row) => isNumeric(row[key])) && !isIdKey(key)
    );
  }, [columns, rows]);

  const dateLikeColumns = useMemo(() => {
    return columns.filter((key) => rows.some((row) => isDateLike(row[key])));
  }, [columns, rows]);

  const categoricalColumns = useMemo(() => {
    return columns.filter((key) => !numericColumns.includes(key));
  }, [columns, numericColumns]);

  useEffect(() => {
    if (!columns.length) {
      setLabelKey(null);
      return;
    }
    // Prefer date-like column as label, else first categorical, else first column
    const preferred =
      dateLikeColumns[0] || categoricalColumns[0] || columns[0] || null;
    setLabelKey((prev) => (prev && columns.includes(prev) ? prev : preferred));
  }, [columns, dateLikeColumns, categoricalColumns]);

  useEffect(() => {
    setValueKeys((prev) => {
      const valid = prev.filter((key) => numericColumns.includes(key));
      if (valid.length > 0) return valid;
      if (numericColumns.length > 0) return [numericColumns[0]];
      return [];
    });
  }, [numericColumns]);

  // Suggest chart type automatically based on detected types
  useEffect(() => {
    setChartType((prev) => {
      if (prev) return prev;
      const hasDateX = labelKey
        ? rows.some((r) => isDateLike(r[labelKey!]))
        : false;
      if (hasDateX && (valueKeys.length > 0 || numericColumns.length > 0)) {
        return "line";
      }
      const catCardinality = labelKey
        ? distinctCount(rows.map((r) => r[labelKey!]))
        : Infinity;
      if (
        catCardinality <= 20 &&
        (valueKeys.length > 0 || numericColumns.length > 0)
      ) {
        return "bar";
      }
      if (valueKeys.length === 1 && rows.length <= 30) {
        return "pie";
      }
      return "bar";
    });
  }, [labelKey, valueKeys, numericColumns, rows]);

  const labels = useMemo(() => {
    if (!labelKey) return [];
    return rows.map((row) => formatCell(row[labelKey]));
  }, [rows, labelKey]);

  // Build chart data for bar/line
  const chartDataCartesian = useMemo<
    ChartData<"bar", (number | null)[], string>
  >(() => {
    if (!labelKey || !rows.length) return { labels: [], datasets: [] };
    const activeKeys = valueKeys.length ? valueKeys : numericColumns;
    if (!activeKeys.length) {
      const labelsMap = new Map<string, number>();
      rows.forEach((row) => {
        const l = String(formatCell(row[labelKey]));
        labelsMap.set(l, (labelsMap.get(l) || 0) + 1);
      });
      const labelsArr = Array.from(labelsMap.keys());
      const counts = labelsArr.map((l) => labelsMap.get(l) || 0);
      const colors = palette(1);
      return {
        labels: labelsArr,
        datasets: [
          {
            label: "count",
            data: counts,
            backgroundColor: colors[0] + "b3",
            borderColor: colors[0],
          },
        ],
      };
    }
    const colors = palette(activeKeys.length);
    return {
      labels,
      datasets: activeKeys.map((key, idx) => {
        const data = rows.map((row) => toNumeric(row[key]));
        return {
          label: key,
          data: data.map((d) => (d == null ? null : d)),
          borderColor: colors[idx],
          backgroundColor: colors[idx] + "b3",
        };
      }),
    };
  }, [labelKey, labels, rows, valueKeys, numericColumns]);

  // Build chart data for pie
  const chartDataPie = useMemo<ChartData<
    "pie",
    number[],
    string
  > | null>(() => {
    if (!labelKey || !rows.length) return null;
    const valueKey = valueKeys[0];
    if (!valueKey) return null;
    const nums = rows.map((row) => toNumeric(row[valueKey]));
    const usable = nums.some((n) => n !== null);
    if (!usable) return null;
    const colors = palette(rows.length || 1);
    return {
      labels,
      datasets: [
        {
          label: valueKey,
          data: nums.map((n) => (n == null ? 0 : n)),
          backgroundColor: colors,
          borderColor: colors.map((c) => c + "cc"),
        },
      ],
    };
  }, [labelKey, rows, valueKeys, labels]);

  const optionsBar = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#e5e7eb" } },
        tooltip: {
          callbacks: {
            label: (context) => {
              const label = context.dataset?.label ?? "";
              const value = (context.parsed as { y?: number })?.y;
              return `${label ? `${label}: ` : ""}${value ?? "-"}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9ca3af", maxRotation: 45, minRotation: 0 },
          grid: { color: "rgba(148, 163, 184, 0.1)" },
        },
        y: {
          ticks: { color: "#9ca3af" },
          grid: { color: "rgba(148, 163, 184, 0.1)" },
        },
      },
    }),
    []
  );

  const optionsLine = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#e5e7eb" } },
        tooltip: {
          callbacks: {
            label: (context) => {
              const label = context.dataset?.label ?? "";
              const value = (context.parsed as { y?: number })?.y;
              return `${label ? `${label}: ` : ""}${value ?? "-"}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9ca3af", maxRotation: 45, minRotation: 0 },
          grid: { color: "rgba(148, 163, 184, 0.1)" },
        },
        y: {
          ticks: { color: "#9ca3af" },
          grid: { color: "rgba(148, 163, 184, 0.1)" },
        },
      },
    }),
    []
  );

  const optionsPie = useMemo<ChartOptions<"pie">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#e5e7eb" } } },
    }),
    []
  );

  if (!rows.length) {
    return (
      <div className="text-xs text-gray-500">
        No data available to render a chart
      </div>
    );
  }

  if (!columns.length) {
    return (
      <div className="text-xs text-gray-500">
        No columns found in the dataset
      </div>
    );
  }

  if (!labelKey) {
    return (
      <div className="text-xs text-gray-500">
        Unable to determine a label column
      </div>
    );
  }

  if (
    (chartType === "pie" && !chartDataPie) ||
    (chartType !== "pie" &&
      (!chartDataCartesian || chartDataCartesian.datasets.length === 0))
  ) {
    if (!numericColumns.length) {
      return (
        <div className="text-xs text-gray-500">No numeric columns found</div>
      );
    }

    if (chartType === "pie" && !valueKeys[0]) {
      return (
        <div className="text-xs text-gray-500">
          Select a numeric column for the pie chart
        </div>
      );
    }

    if (chartType !== "pie" && !valueKeys.length) {
      return (
        <div className="text-xs text-gray-500">
          Select at least one numeric column
        </div>
      );
    }

    return (
      <div className="text-xs text-gray-500">
        No numeric data available for charting
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-4">
      <div className="flex flex-wrap gap-3 text-xs text-gray-200">
        <label className="flex items-center gap-2">
          <span className="uppercase tracking-wide text-[10px] text-gray-400">
            Chart type
          </span>
          <select
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-gray-100"
            value={chartType}
            onChange={(event) => setChartType(event.target.value as ChartType)}
          >
            <option value="bar">Bar</option>
            <option value="line">Line</option>
            <option value="pie">Pie</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="uppercase tracking-wide text-[10px] text-gray-400">
            Label column
          </span>
          <select
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-gray-100"
            value={labelKey ?? ""}
            onChange={(event) => setLabelKey(event.target.value)}
          >
            {columns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
        </label>
        {chartType === "pie" ? (
          <label className="flex items-center gap-2">
            <span className="uppercase tracking-wide text-[10px] text-gray-400">
              Value column
            </span>
            <select
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-gray-100"
              value={valueKeys[0] ?? ""}
              onChange={(event) => setValueKeys([event.target.value])}
            >
              {numericColumns.length ? (
                numericColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))
              ) : (
                <option value="" disabled>
                  No numeric columns
                </option>
              )}
            </select>
          </label>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="uppercase tracking-wide text-[10px] text-gray-400">
              Value columns
            </span>
            {numericColumns.length ? (
              numericColumns.map((col) => {
                const checked = valueKeys.includes(col);
                return (
                  <label
                    key={col}
                    className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1"
                  >
                    <input
                      type="checkbox"
                      className="accent-blue-500"
                      checked={checked}
                      onChange={(event) => {
                        setValueKeys((current) => {
                          if (event.target.checked) {
                            return Array.from(new Set([...current, col]));
                          }
                          return current.filter((key) => key !== col);
                        });
                      }}
                    />
                    <span>{col}</span>
                  </label>
                );
              })
            ) : (
              <span className="text-gray-500">No numeric columns found</span>
            )}
          </div>
        )}
      </div>
      <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-4">
        {chartType === "bar" && (
          <Bar data={chartDataCartesian} options={optionsBar} height={360} />
        )}
        {chartType === "line" && (
          <Line
            data={
              chartDataCartesian as unknown as ChartData<
                "line",
                (number | null)[],
                string
              >
            }
            options={optionsLine}
            height={360}
          />
        )}
        {chartType === "pie" && chartDataPie && (
          <Pie data={chartDataPie} options={optionsPie} height={360} />
        )}
      </div>
    </div>
  );
}

export default DataChart;
