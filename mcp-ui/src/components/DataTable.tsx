"use client";
import { formatCell, Row } from "../utils/format";

export function DataTable({ rows }: { rows: Row[] }) {
  if (!rows || rows.length === 0) return null;
  const cols = Array.from(new Set(rows.flatMap((o) => Object.keys(o))));
  const limited = rows.slice(0, 50);
  const handleCopy = async () => {
    try {
      const json = JSON.stringify(rows, null, 2);
      await navigator.clipboard.writeText(json);
    } catch (err) {
      console.error("Copy failed", err);
    }
  };
  return (
    <div className="overflow-x-auto border border-zinc-800 rounded-lg mt-2 shadow-sm relative">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 text-xs px-3 py-1 rounded-md bg-zinc-800/70 hover:bg-zinc-700/70 border border-zinc-700/70"
        title="Copy JSON"
      >
        Copy JSON
      </button>
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

export default DataTable;
