import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const {
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_USER,
    MYSQL_PASSWORD,
    MYSQL_DATABASE,
    SCHEMA_MINIFY = "true",
    SCHEMA_SAMPLE_HINTS = "false",
    SCHEMA_SAMPLE_LIMIT = "50",
    SCHEMA_SAMPLE_TABLE_LIMIT = "8",
  } = process.env;

  if (!MYSQL_USER || !MYSQL_DATABASE) {
    throw new Error(
      "Missing MYSQL_USER or MYSQL_DATABASE. Set MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE in environment."
    );
  }

  const connection = await mysql.createConnection({
    host: MYSQL_HOST || "localhost",
    port: Number(MYSQL_PORT) || 3306,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    multipleStatements: false,
  });

  try {
    const schemaName = MYSQL_DATABASE;

    const [tablesRows] = await connection.execute(
      `SELECT TABLE_NAME, ENGINE, TABLE_ROWS
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [schemaName]
    );
    const tableNames = tablesRows.map((r) => r.TABLE_NAME);
    const tableMeta = new Map(
      tablesRows.map((r) => [
        r.TABLE_NAME,
        {
          engine: r.ENGINE || undefined,
          row_count:
            typeof r.TABLE_ROWS === "number" && !Number.isNaN(r.TABLE_ROWS)
              ? r.TABLE_ROWS
              : undefined,
        },
      ])
    );

    const [columnsRows] = await connection.execute(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
              COLUMN_KEY, COLUMN_DEFAULT,
              CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [schemaName]
    );

    const [uniqueRows] = await connection.execute(
      `SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.ORDINAL_POSITION
       FROM information_schema.TABLE_CONSTRAINTS tc
       JOIN information_schema.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA   = kcu.TABLE_SCHEMA
        AND tc.TABLE_NAME     = kcu.TABLE_NAME
       WHERE tc.TABLE_SCHEMA = ?
         AND tc.CONSTRAINT_TYPE = 'UNIQUE'
       ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
      [schemaName]
    );

    const uniqueByTableConstraint = new Map();
    for (const row of uniqueRows) {
      const key = `${row.TABLE_NAME}::${row.CONSTRAINT_NAME}`;
      if (!uniqueByTableConstraint.has(key))
        uniqueByTableConstraint.set(key, []);
      uniqueByTableConstraint.get(key).push(row.COLUMN_NAME);
    }

    const singleColumnUnique = new Map();
    const multiColumnUnique = new Map();
    for (const [key, cols] of uniqueByTableConstraint.entries()) {
      const [tableName, constraint] = key.split("::");
      if (cols.length === 1) {
        singleColumnUnique.set(`${tableName}::${cols[0]}`, true);
      } else {
        if (!multiColumnUnique.has(tableName))
          multiColumnUnique.set(tableName, []);
        multiColumnUnique
          .get(tableName)
          .push({ name: constraint, columns: cols });
      }
    }

    const [fkRows] = await connection.execute(
      `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ?
         AND REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [schemaName]
    );
    const fksByTable = new Map();
    for (const row of fkRows) {
      if (!fksByTable.has(row.TABLE_NAME)) fksByTable.set(row.TABLE_NAME, []);
      fksByTable.get(row.TABLE_NAME).push({
        column: row.COLUMN_NAME,
        refTable: row.REFERENCED_TABLE_NAME,
        refColumn: row.REFERENCED_COLUMN_NAME,
      });
    }

    const [indexRows] = await connection.execute(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [schemaName]
    );
    const indexesByTable = new Map();
    for (const r of indexRows) {
      if (!indexesByTable.has(r.TABLE_NAME))
        indexesByTable.set(r.TABLE_NAME, new Map());
      const m = indexesByTable.get(r.TABLE_NAME);
      if (!m.has(r.INDEX_NAME)) {
        m.set(r.INDEX_NAME, {
          name: r.INDEX_NAME,
          unique: r.NON_UNIQUE === 0,
          columns: [],
        });
      }
      m.get(r.INDEX_NAME).columns.push(r.COLUMN_NAME);
    }

    const columnsByTable = new Map();
    for (const col of columnsRows) {
      if (!columnsByTable.has(col.TABLE_NAME))
        columnsByTable.set(col.TABLE_NAME, []);
      const isPk = col.COLUMN_KEY === "PRI";
      const uniqueKey = `${col.TABLE_NAME}::${col.COLUMN_NAME}`;
      const isUnique = isPk || singleColumnUnique.has(uniqueKey);

      const out = {
        name: col.COLUMN_NAME,
        type: col.DATA_TYPE || col.COLUMN_TYPE,
        pk: isPk || undefined,
        unique: isUnique && !isPk ? true : undefined,
        nullable: col.IS_NULLABLE === "YES" ? true : undefined,
        default: col.COLUMN_DEFAULT ?? undefined,
        maxlen:
          col.CHARACTER_MAXIMUM_LENGTH != null
            ? Number(col.CHARACTER_MAXIMUM_LENGTH)
            : undefined,
        precision:
          col.NUMERIC_PRECISION != null
            ? Number(col.NUMERIC_PRECISION)
            : undefined,
        scale:
          col.NUMERIC_SCALE != null ? Number(col.NUMERIC_SCALE) : undefined,
        enum_values:
          (col.DATA_TYPE === "enum" && parseEnumValues(col.COLUMN_TYPE)) ||
          undefined,
      };
      columnsByTable.get(col.TABLE_NAME).push(out);
    }

    const tables = [];
    for (const t of tableNames) {
      const rawCols = columnsByTable.get(t) || [];
      const columns = rawCols.map(stripUndef);

      const fks = (fksByTable.get(t) || []).map((f) => ({
        column: f.column,
        refTable: f.refTable,
        refColumn: f.refColumn,
      }));

      const idxMap = indexesByTable.get(t);
      const indexes = idxMap
        ? Array.from(idxMap.values()).map(stripUndef)
        : undefined;

      const multiU = multiColumnUnique.get(t);

      const joins = (fksByTable.get(t) || []).map((f) => ({
        to: f.refTable,
        on: [`${t}.${f.column} = ${f.refTable}.${f.refColumn}`],
        type: "fk",
      }));

      const meta = tableMeta.get(t) || {};

      const tableEntry = {
        name: t,
        engine: meta.engine,
        row_count: meta.row_count,
        columns,
        ...(fks.length ? { fks } : {}),
        ...(indexes && indexes.length ? { indexes } : {}),
        ...(multiU && multiU.length ? { unique_composites: multiU } : {}),
        ...(joins.length ? { joins } : {}),
      };

      tables.push(stripUndef(tableEntry));
    }

    if (SCHEMA_SAMPLE_HINTS.toLowerCase() === "true") {
      const limit = Number(SCHEMA_SAMPLE_LIMIT) || 50;
      const tableLimit = Math.max(1, Number(SCHEMA_SAMPLE_TABLE_LIMIT) || 8);

      const picked = [...tables]
        .sort((a, b) => (a.row_count ?? 0) - (b.row_count ?? 0))
        .slice(0, tableLimit);

      const textCols = {};
      for (const t of picked) {
        const tCols = (t.columns || []).filter((c) =>
          [
            "char",
            "varchar",
            "text",
            "tinytext",
            "mediumtext",
            "longtext",
            "enum",
          ].includes((c.type || "").toString().toLowerCase())
        );
        if (tCols.length) textCols[t.name] = tCols.map((c) => c.name);
      }

      const hints = [];
      const tablesArr = Object.keys(textCols);
      for (let i = 0; i < tablesArr.length; i++) {
        for (let j = i + 1; j < tablesArr.length; j++) {
          const A = tablesArr[i];
          const B = tablesArr[j];

          for (const colA of textCols[A]) {
            const sampleVals = await sampleDistinct(
              connection,
              schemaName,
              A,
              colA,
              limit
            );
            if (!sampleVals.length) continue;

            for (const colB of textCols[B]) {
              const matchCount = await countMatches(
                connection,
                schemaName,
                B,
                colB,
                sampleVals
              );
              if (matchCount >= Math.max(5, Math.ceil(limit * 0.15))) {
                hints.push({
                  from: `${A}.${colA}`,
                  to: `${B}.${colB}`,
                  heuristic: "value_overlap",
                  sample: { checked: sampleVals.length, matched: matchCount },
                  suggested_on: `${A}.${colA} = ${B}.${colB}`,
                });
              }
            }
          }
        }
      }

      if (hints.length) {
        hints.sort(
          (a, b) =>
            b.sample.matched / b.sample.checked -
            a.sample.matched / a.sample.checked
        );
        var valueJoinHints = hints.slice(0, 20);
      }
    }

    const output = stripUndef({
      version: new Date().toISOString().slice(0, 10),
      dialect: "mysql",
      database: schemaName,
      tables,
      ...(typeof valueJoinHints !== "undefined" && valueJoinHints.length
        ? { value_join_hints: valueJoinHints }
        : {}),
    });

    const minify = SCHEMA_MINIFY.toLowerCase() === "true";
    const text = minify
      ? JSON.stringify(output)
      : JSON.stringify(output, null, 2);
    process.stdout.write(text + "\n");
  } finally {
    await connection.end();
  }
}

function stripUndef(obj) {
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripUndef);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0))
      continue;
    if (typeof v === "object") {
      const sv = stripUndef(v);
      if (sv == null) continue;
      if (Array.isArray(sv) && sv.length === 0) continue;
      if (!Array.isArray(sv) && Object.keys(sv).length === 0) continue;
      out[k] = sv;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function parseEnumValues(columnType) {
  if (!columnType || !columnType.startsWith("enum(")) return null;
  const inside = columnType.slice(5, -1);
  const parts = [];
  let curr = "";
  let inStr = false;
  for (let i = 0; i < inside.length; i++) {
    const ch = inside[i];
    if (ch === "'" && inside[i - 1] !== "\\") {
      inStr = !inStr;
      curr += ch;
    } else if (ch === "," && !inStr) {
      parts.push(curr.trim());
      curr = "";
    } else {
      curr += ch;
    }
  }
  if (curr) parts.push(curr.trim());
  return parts
    .map((p) => (p.startsWith("'") && p.endsWith("'") ? p.slice(1, -1) : p))
    .map((s) => s.replace(/\\'/g, "'"));
}

async function sampleDistinct(conn, schema, table, column, limit) {
  const q = `SELECT DISTINCT \`${column}\` AS v
             FROM \`${schema}\`.\`${table}\`
             WHERE \`${column}\` IS NOT NULL AND \`${column}\` <> ''
             LIMIT ?`;
  const [rows] = await conn.execute(q, [limit]);
  return rows.map((r) => r.v).filter((v) => typeof v === "string");
}

async function countMatches(conn, schema, table, column, values) {
  if (!values.length) return 0;
  const placeholders = values.map(() => "?").join(",");
  const q = `SELECT COUNT(*) AS c
             FROM \`${schema}\`.\`${table}\`
             WHERE \`${column}\` IN (${placeholders})`;
  const [rows] = await conn.execute(q, values);
  return Number(rows[0]?.c || 0);
}

main().catch((err) => {
  console.error("Schema generation failed:", err.stack || err.message);
  process.exit(1);
});
