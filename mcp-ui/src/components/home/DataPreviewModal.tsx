"use client";

export default function DataPreviewModal({
  open,
  table,
  rows,
  onClose,
}: {
  open: boolean;
  table: string | null;
  rows: Array<Record<string, unknown>>;
  onClose: () => void;
}) {
  if (!open || !table) return null;
  const columns = (() => {
    const set = new Set<string>();
    rows.forEach((r) => Object.keys(r).forEach((k) => set.add(k)));
    return Array.from(set);
  })();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose}></div>
      <div className="relative w-[94vw] max-w-4xl rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-zinc-100">
            {table} - Preview
          </div>
          <button
            className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-3 max-h-[60vh] overflow-auto rounded-lg border border-zinc-800">
          <table className="w-full text-[11px] text-zinc-300">
            <thead className="bg-zinc-900/60 sticky top-0">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="px-2 py-1 text-left">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="odd:bg-zinc-900/30">
                  {columns.map((c) => (
                    <td key={c} className="px-2 py-1">
                      {formatCell(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    className="px-2 py-3 text-zinc-500"
                    colSpan={Math.max(1, columns.length)}
                  >
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}
