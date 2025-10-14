import "dotenv/config";
import { execFile } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { Client as PgClient } from "pg";
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

  // Also dump Postgres views into reports
  const {
    PGHOST = process.env.POSTGRES_HOST,
    PGPORT = process.env.POSTGRES_PORT,
    PGUSER = process.env.POSTGRES_USER,
    PGPASSWORD = process.env.POSTGRES_PASSWORD,
    PGDATABASE = process.env.POSTGRES_DB,
  } = process.env;
  if (PGUSER && PGDATABASE) {
    const client = new PgClient({
      host: PGHOST || "localhost",
      port: Number(PGPORT) || 5432,
      user: PGUSER,
      password: PGPASSWORD,
      database: PGDATABASE,
    });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT schemaname AS table_schema, viewname AS table_name, definition AS view_definition
         FROM pg_views
         WHERE schemaname NOT IN ('pg_catalog','information_schema')
         ORDER BY schemaname, viewname`
      );
      const jsonPath = resolve(reportsDir, "postgres.views.json");
      await writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf8");

      const sqlLines = rows.length
        ? rows.map((r) => {
            const name = `"${r.table_schema}"."${r.table_name}"`;
            return `DROP VIEW IF EXISTS ${name} CASCADE;\nCREATE OR REPLACE VIEW ${name} AS\n${r.view_definition};\n`;
          })
        : ["-- No views found\n"];
      const sqlPath = resolve(reportsDir, "postgres.views.sql");
      const viewsSql = sqlLines.join("\n");
      await writeFile(sqlPath, viewsSql, "utf8");
      process.stdout.write(
        `Saved Postgres views (${rows.length}) to ${jsonPath} and ${sqlPath}\n`
      );

      // Bundle into a single file
      const bundle = [
        "# Prisma schema snapshot\n",
        "```prisma\n",
        schemaText,
        "\n```\n\n",
        "# Postgres views (generated)\n",
        "```sql\n",
        viewsSql,
        "\n```\n",
      ].join("");
      await writeFile(bundlePath, bundle, "utf8");
      process.stdout.write(`Saved bundle to ${bundlePath}\n`);
    } finally {
      await client.end();
    }
  } else {
    process.stdout.write(
      "PG* env not set; skipped view export (set PGUSER and PGDATABASE).\n"
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
