"use client";

import { useEffect, useState } from "react";
import BulkInsertModal from "./BulkInsertModal";
import DataPreviewModal from "./DataPreviewModal";

export default function BulkInsertTab({
  fetchTables,
  describeTable,
  viewTableData,
  executeSql,
}: {
  fetchTables: () => Promise<string[]>;
  describeTable: (
    table: string
  ) => Promise<Array<Record<string, unknown>> | null>;
  viewTableData: (
    table: string,
    limit: number,
    offset: number
  ) => Promise<Array<Record<string, unknown>>>;
  executeSql: (sql: string) => Promise<unknown>;
}) {
  const [tables, setTables] = useState<string[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedForInsert, setSelectedForInsert] = useState<string | null>(
    null
  );
  const [schemaRows, setSchemaRows] = useState<Array<
    Record<string, unknown>
  > | null>(null);
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTable, setPreviewTable] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<
    Array<Record<string, unknown>>
  >([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const xs = await fetchTables();
        setTables(xs);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load tables");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async ({
    table,
    mode,
    textData,
    csvFile,
  }: {
    table: string;
    mode: "text" | "csv";
    textData?: string;
    csvFile?: File | null;
  }) => {
    try {
      let rows: Array<Record<string, unknown>> = [];
      if (mode === "text") {
        const parsed = JSON.parse(textData || "[]");
        if (!Array.isArray(parsed)) throw new Error("JSON must be an array");
        rows = parsed as Array<Record<string, unknown>>;
      } else if (mode === "csv") {
        if (!csvFile) throw new Error("CSV file required");
        const text = await csvFile.text();
        rows = parseCsv(text);
      }
      if (!rows.length) throw new Error("No rows to insert");

      const { columns, valuesMatrix } = normalizeRows(rows);
      const valuesSql = valuesMatrix
        .map(
          (vals) =>
            `(${vals
              .map((v) =>
                v === null || v === undefined ? "NULL" : sqlQuote(v)
              )
              .join(", ")})`
        )
        .join(",\n");
      const columnSql = columns.map((c) => `\`${c}\``).join(", ");
      const sql = `INSERT INTO \`${table}\` (${columnSql}) VALUES\n${valuesSql};`;
      const res = await executeSql(sql);
      setLastResult(res ?? { ok: true });
      setOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Insert failed");
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-zinc-200">Bulk Insert</div>
        <div className="flex items-center gap-2">
          <button
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            onClick={() => setOpen(true)}
            disabled={loading || !!error || tables.length === 0}
          >
            New Insert
          </button>
          <button
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            onClick={async () => {
              setLoading(true);
              setError(null);
              try {
                const xs = await fetchTables();
                setTables(xs);
              } catch (err: unknown) {
                setError(
                  err instanceof Error ? err.message : "Failed to load tables"
                );
              } finally {
                setLoading(false);
              }
            }}
          >
            Refresh
          </button>
        </div>
      </div>
      {loading && (
        <div className="mt-3 text-xs text-zinc-400">Loading tables...</div>
      )}
      {error && (
        <div className="mt-3 text-xs text-red-400">{String(error)}</div>
      )}
      {!loading && !error && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs text-zinc-400">
              {tables.length > 0
                ? `Loaded ${tables.length} tables`
                : "No tables found"}
            </div>
            {tables.length > 0 && (
              <input
                className="text-xs px-3 py-2 rounded-lg bg-zinc-800/70 border border-zinc-700/60 text-zinc-200 w-56"
                placeholder="Search tables..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
              />
            )}
          </div>
          {tables.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {tables
                .filter((t) =>
                  !filterQuery.trim()
                    ? true
                    : t.toLowerCase().includes(filterQuery.toLowerCase())
                )
                .map((t) => (
                  <div
                    key={t}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 shadow-sm hover:shadow-md transition"
                  >
                    <div
                      className="text-xs text-zinc-100 truncate font-medium"
                      title={t}
                    >
                      {t}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                        onClick={async () => {
                          setSelectedForInsert(t);
                          setOpen(true);
                          try {
                            const rows = await describeTable(t);
                            setSchemaRows(rows || null);
                          } catch {
                            setSchemaRows(null);
                          }
                        }}
                      >
                        Insert
                      </button>
                      <button
                        className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                        onClick={async () => {
                          try {
                            setPreviewTable(t);
                            setPreviewOpen(true);
                            const rows = await viewTableData(t, 50, 0);
                            setPreviewRows(rows);
                          } catch {
                            setPreviewRows([]);
                          }
                        }}
                      >
                        View Data
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {lastResult != null && (
        <div className="mt-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-300">
          Insert executed.
        </div>
      )}

      <BulkInsertModal
        open={open}
        tables={tables}
        initialTable={selectedForInsert || undefined}
        schemaRows={schemaRows}
        onClose={() => setOpen(false)}
        onSubmit={handleSubmit}
        onSelectTable={async (tbl) => {
          try {
            const rows = await describeTable(tbl);
            setSchemaRows(rows || null);
          } catch {
            setSchemaRows(null);
          }
        }}
      />

      <DataPreviewModal
        open={previewOpen}
        table={previewTable}
        rows={previewRows}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}

function parseCsv(text: string): Array<Record<string, unknown>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] ?? null;
    });
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === ",") {
        result.push(current);
        current = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result.map((s) => s.trim());
}

function normalizeRows(rows: Array<Record<string, unknown>>): {
  columns: string[];
  valuesMatrix: unknown[][];
} {
  const columnSet = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => columnSet.add(k)));
  const columns = Array.from(columnSet);
  type RowRecord = Record<string, unknown>;
  const valuesMatrix = rows.map((r: RowRecord) =>
    columns.map((c) => (c in r ? (r as RowRecord)[c] : null))
  );
  return { columns, valuesMatrix };
}

function sqlQuote(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  const s = String(value);
  const escaped = s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `'${escaped}'`;
}
