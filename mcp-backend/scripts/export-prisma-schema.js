import "dotenv/config";
import { execFile } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import mysql from "mysql2/promise";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runPrismaGetDmmf(cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["prisma", "format"],
      { cwd, env: process.env },
      (err) => {
        if (err) return reject(err);
        resolvePromise();
      }
    );
  });
}

async function runPrismaDbPull(cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["prisma", "db", "pull"],
      { cwd, env: process.env },
      (err) => {
        if (err) return reject(err);
        resolvePromise();
      }
    );
  });
}

async function main() {
  const backendRoot = resolve(__dirname, "..");
  const schemaPath = resolve(backendRoot, "prisma", "schema.prisma");
  const reportsDir = resolve(backendRoot, "reports");
  const outPath = resolve(reportsDir, "prisma.schema.prisma");
  const bundlePath = resolve(reportsDir, "schema.bundle.txt");

  await runPrismaDbPull(backendRoot);
  await runPrismaGetDmmf(backendRoot);

  await mkdir(reportsDir, { recursive: true });

  // Read the updated schema.prisma and write a snapshot copy into reports
  const schemaText = await (
    await import("node:fs/promises")
  ).readFile(schemaPath, "utf8");
  await writeFile(outPath, schemaText, "utf8");
  process.stdout.write(`Saved Prisma schema snapshot to ${outPath}\n`);

  // Also dump MySQL views into reports
  const {
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_USER,
    MYSQL_PASSWORD,
    MYSQL_DATABASE,
    MYSQL_VIEWS_SCHEMAS,
    MYSQL_VIEWS_ALL,
  } = process.env;
  if (
    MYSQL_USER &&
    (MYSQL_DATABASE || MYSQL_VIEWS_ALL === "true" || MYSQL_VIEWS_SCHEMAS)
  ) {
    const conn = await mysql.createConnection({
      host: MYSQL_HOST || "localhost",
      port: Number(MYSQL_PORT) || 3306,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE || undefined,
    });
    try {
      // Determine schemas to export
      let schemas = [];
      if (MYSQL_VIEWS_ALL && MYSQL_VIEWS_ALL.toLowerCase() === "true") {
        const [schemaRows] = await conn.execute(
          `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
           WHERE SCHEMA_NAME NOT IN ('mysql','sys','performance_schema','information_schema')
           ORDER BY SCHEMA_NAME`
        );
        schemas = schemaRows.map((r) => r.SCHEMA_NAME);
      } else if (MYSQL_VIEWS_SCHEMAS) {
        schemas = MYSQL_VIEWS_SCHEMAS.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (MYSQL_DATABASE) {
        schemas = [MYSQL_DATABASE];
      }

      if (!schemas.length) {
        process.stdout.write(
          "No schemas selected for view export. Skipping.\n"
        );
        return;
      }

      const placeholders = schemas.map(() => "?").join(",");
      const [rows] = await conn.execute(
        `SELECT TABLE_SCHEMA, TABLE_NAME, VIEW_DEFINITION, DEFINER, SECURITY_TYPE
         FROM information_schema.VIEWS
         WHERE TABLE_SCHEMA IN (${placeholders})
         ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        schemas
      );

      const jsonPath = resolve(reportsDir, "mysql.views.json");
      await writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf8");

      const sqlLines = rows.length
        ? rows.map((r) => {
            const name = `\`${r.TABLE_SCHEMA}\`.\`${r.TABLE_NAME}\``;
            return `DROP VIEW IF EXISTS ${name};\nCREATE OR REPLACE VIEW ${name} AS\n${r.VIEW_DEFINITION};\n`;
          })
        : ["-- No views found for schemas: " + schemas.join(", ") + "\n"];
      const sqlPath = resolve(reportsDir, "mysql.views.sql");
      const viewsSql = sqlLines.join("\n");
      await writeFile(sqlPath, viewsSql, "utf8");
      process.stdout.write(
        `Saved MySQL views (${rows.length}) to ${jsonPath} and ${sqlPath}\n`
      );

      // Bundle into a single file
      const bundle = [
        "# Prisma schema snapshot\n",
        "```prisma\n",
        schemaText,
        "\n```\n\n",
        "# MySQL views (generated)\n",
        "```sql\n",
        viewsSql,
        "\n```\n",
      ].join("");
      await writeFile(bundlePath, bundle, "utf8");
      process.stdout.write(`Saved bundle to ${bundlePath}\n`);
    } finally {
      await conn.end();
    }
  } else {
    process.stdout.write(
      "MYSQL_* env not set; skipped view export (set MYSQL_USER and MYSQL_DATABASE).\n"
    );
  }
}

main().catch((err) => {
  console.error(
    "Export Prisma schema failed:",
    err?.stack || err?.message || err
  );
  process.exit(1);
});
