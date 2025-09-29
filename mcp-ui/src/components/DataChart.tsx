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
    return columns.filter((key) => rows.some((row) => isNumeric(row[key])));
  }, [columns, rows]);

  useEffect(() => {
    if (!columns.length) {
      setLabelKey(null);
      return;
    }
    setLabelKey((prev) => (prev && columns.includes(prev) ? prev : columns[0]));
  }, [columns]);

  useEffect(() => {
    setValueKeys((prev) => {
      const valid = prev.filter((key) => numericColumns.includes(key));
      if (valid.length > 0) return valid;
      if (numericColumns.length > 0) return [numericColumns[0]];
      return [];
    });
  }, [numericColumns]);

  const labels = useMemo(() => {
    if (!labelKey) return [];
    return rows.map((row) => formatCell(row[labelKey]));
  }, [rows, labelKey]);

  const chartData = useMemo<ChartData<ChartType, (number | null)[], string> | null>(() => {
    if (!labelKey || !rows.length) return null;

    if (chartType === "pie") {
      const valueKey = valueKeys[0];
      if (!valueKey) return null;
      const data = rows.map((row) => toNumeric(row[valueKey]));
      const usable = data.some((d) => d !== null);
      if (!usable) return null;
      const colors = palette(rows.length || 1);
      return {
        labels,
        datasets: [
          {
            label: valueKey,
            data: data.map((d) => (d == null ? 0 : d)),
            backgroundColor: colors,
            borderColor: colors.map((c) => c + "cc"),
          },
        ],
      };
    }

    const activeKeys = valueKeys.length ? valueKeys : numericColumns;
    if (!activeKeys.length) return null;
    const colors = palette(activeKeys.length);
    return {
      labels,
      datasets: activeKeys.map((key, idx) => {
        const data = rows.map((row) => toNumeric(row[key]));
        return {
          label: key,
          data: data.map((d) => (d == null ? null : d)),
          borderColor: colors[idx],
          backgroundColor:
            chartType === "bar" ? colors[idx] + "b3" : colors[idx],
          fill: chartType === "line",
          tension: chartType === "line" ? 0.35 : undefined,
        };
      }),
    };
  }, [chartType, labelKey, labels, rows, valueKeys, numericColumns]);

  const options = useMemo<ChartOptions<ChartType>>(() => {
    const shared = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#e5e7eb",
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const label = context.dataset?.label ?? "";
              const value =
                chartType === "pie"
                  ? context.parsed
                  : (context.parsed as { y?: number })?.y;
              return `${label ? `${label}: ` : ""}${value ?? "-"}`;
            },
          },
        },
      },
    } satisfies ChartOptions<ChartType>;

    if (chartType === "pie") {
      return shared;
    }

    return {
      ...shared,
      scales: {
        x: {
          ticks: {
            color: "#9ca3af",
            maxRotation: 45,
            minRotation: 0,
          },
          grid: {
            color: "rgba(148, 163, 184, 0.1)",
          },
        },
        y: {
          ticks: {
            color: "#9ca3af",
          },
          grid: {
            color: "rgba(148, 163, 184, 0.1)",
          },
        },
      },
    } satisfies ChartOptions<ChartType>;
  }, [chartType]);

  if (!rows.length) {
    return (
      <div className="text-xs text-gray-500">
        No data available to render a chart
      </div>
    );
  }

  if (!columns.length) {
    return (
      <div className="text-xs text-gray-500">No columns found in the dataset</div>
    );
  }

  if (!labelKey) {
    return (
      <div className="text-xs text-gray-500">
        Unable to determine a label column
      </div>
    );
  }

  if (!chartData) {
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
        <div className="text-xs text-gray-500">Select at least one numeric column</div>
      );
    }

    return (
      <div className="text-xs text-gray-500">
        No numeric data available for charting
      </div>
    );
  }

  const ChartComponent = chartType === "bar" ? Bar : chartType === "line" ? Line : Pie;

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
        <ChartComponent
          data={chartData}
          options={options}
          height={360}
        />
      </div>
    </div>
  );
}

export default DataChart;
