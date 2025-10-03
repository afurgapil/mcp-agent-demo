"use client";

import { useState } from "react";

export default function BulkInsertModal({
  open,
  tables,
  initialTable,
  schemaRows,
  onClose,
  onSubmit,
  onSelectTable,
}: {
  open: boolean;
  tables: string[];
  initialTable?: string;
  schemaRows?: Array<Record<string, unknown>> | null;
  onClose: () => void;
  onSubmit: (payload: {
    table: string;
    mode: "text" | "csv";
    textData?: string;
    csvFile?: File | null;
  }) => void | Promise<void>;
  onSelectTable?: (table: string) => void | Promise<void>;
}) {
  const [selectedTable, setSelectedTable] = useState<string>(
    initialTable || ""
  );
  const [mode, setMode] = useState<"text" | "csv">("text");
  const [textData, setTextData] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);

  if (!open) return null;

  const jsonTemplate = (() => {
    const cols: string[] = Array.isArray(schemaRows)
      ? schemaRows
          .map((r) => String((r as Record<string, unknown>)["Field"] ?? ""))
          .filter(Boolean)
      : [];
    const sampleRow: Record<string, unknown> = {};
    cols.slice(0, 4).forEach((c, i) => (sampleRow[c] = i + 1));
    return JSON.stringify([sampleRow], null, 2);
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose}></div>
      <div className="relative w-[92vw] max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl">
        <div className="text-sm font-semibold text-zinc-100">Bulk Insert</div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">Table</label>
            <select
              className="w-full rounded-lg bg-zinc-800/70 border border-zinc-700/60 p-2 text-sm text-zinc-100"
              value={selectedTable}
              onChange={async (e) => {
                const val = e.target.value;
                setSelectedTable(val);
                if (onSelectTable) {
                  try {
                    await onSelectTable(val);
                  } catch {}
                }
              }}
            >
              <option value="">Select a table</option>
              {tables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">Input Mode</label>
            <div className="flex items-center gap-2">
              <button
                className={`text-[11px] px-2 py-1 rounded border ${
                  mode === "text"
                    ? "bg-blue-600/30 border-blue-500/40 text-blue-200"
                    : "bg-zinc-800 border-zinc-700 text-zinc-300"
                }`}
                onClick={() => setMode("text")}
              >
                JSON
              </button>
              <button
                className={`text-[11px] px-2 py-1 rounded border ${
                  mode === "csv"
                    ? "bg-blue-600/30 border-blue-500/40 text-blue-200"
                    : "bg-zinc-800 border-zinc-700 text-zinc-300"
                }`}
                onClick={() => setMode("csv")}
              >
                CSV
              </button>
            </div>
          </div>
        </div>

        {Array.isArray(schemaRows) && schemaRows.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-zinc-400 mb-2">Table Schema</div>
              <div className="flex flex-wrap gap-1">
                {schemaRows.slice(0, 6).map((row, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700"
                  >
                    {String((row as Record<string, unknown>)["Field"] ?? "")}
                  </span>
                ))}
                {schemaRows.length > 6 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                    +{schemaRows.length - 6} more
                  </span>
                )}
              </div>
            </div>
            <div className="max-h-48 overflow-auto rounded-lg border border-zinc-800">
              <table className="w-full text-[11px] text-zinc-300">
                <thead className="bg-zinc-900/60">
                  <tr>
                    <th className="px-2 py-1 text-left">Field</th>
                    <th className="px-2 py-1 text-left">Type</th>
                    <th className="px-2 py-1 text-left">Null</th>
                    <th className="px-2 py-1 text-left">Key</th>
                    <th className="px-2 py-1 text-left">Default</th>
                    <th className="px-2 py-1 text-left">Extra</th>
                  </tr>
                </thead>
                <tbody>
                  {schemaRows.map((row, idx) => (
                    <tr key={idx} className="odd:bg-zinc-900/30">
                      <td className="px-2 py-1">
                        {String(
                          (row as Record<string, unknown>)["Field"] ?? ""
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {String((row as Record<string, unknown>)["Type"] ?? "")}
                      </td>
                      <td className="px-2 py-1">
                        {String((row as Record<string, unknown>)["Null"] ?? "")}
                      </td>
                      <td className="px-2 py-1">
                        {String((row as Record<string, unknown>)["Key"] ?? "")}
                      </td>
                      <td className="px-2 py-1">
                        {String(
                          (row as Record<string, unknown>)["Default"] ?? ""
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {String(
                          (row as Record<string, unknown>)["Extra"] ?? ""
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {mode === "text" ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-zinc-400">
                Rows JSON (array of objects)
              </label>
              <button
                className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                onClick={() => setTextData(jsonTemplate)}
              >
                Insert sample
              </button>
            </div>
            <textarea
              className="w-full h-44 rounded-lg bg-zinc-800/70 border border-zinc-700/60 p-2 text-sm text-zinc-100"
              placeholder='[{"col1": "value"}, {"col1": "value2"}]'
              value={textData}
              onChange={(e) => setTextData(e.target.value)}
            />
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <label className="text-xs text-zinc-400">CSV File</label>
            <input
              type="file"
              accept=".csv"
              className="block w-full text-xs text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
            />
            <p className="text-[11px] text-zinc-500">
              First line should contain column headers.
            </p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="text-xs px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60"
            disabled={
              !selectedTable || (mode === "text" ? !textData.trim() : !csvFile)
            }
            onClick={() =>
              onSubmit({ table: selectedTable, mode, textData, csvFile })
            }
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
