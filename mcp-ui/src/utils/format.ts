export type Row = Record<string, unknown>;

type MCPResult = {
  content?: Array<{ text?: string }>;
  rows?: Array<Row>;
  [key: string]: unknown;
};

export function extractRows(result: unknown): Row[] {
  const rows: Row[] = [];
  if (!result || typeof result !== "object") return rows;
  const r = result as MCPResult;
  if (Array.isArray(r.content)) {
    for (const item of r.content) {
      const txt = item?.text;
      if (typeof txt === "string") {
        try {
          const obj = JSON.parse(txt);
          if (obj && typeof obj === "object") rows.push(obj as Row);
        } catch {}
      }
    }
  }
  if (Array.isArray(r.rows)) {
    for (const obj of r.rows) {
      if (obj && typeof obj === "object") rows.push(obj as Row);
    }
  }
  return rows;
}

export function schemaSourceLabel(source?: string | null): string | null {
  if (!source) return null;
  switch (source) {
    case "custom":
      return "User request";
    case "config":
      return "Configuration";
    case "fetched":
      return "Automatically fetched from MCP";
    case "cache":
      return "MCP cache";
    case "none":
      return "Not specified";
    default:
      return source;
  }
}

export function formatCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
