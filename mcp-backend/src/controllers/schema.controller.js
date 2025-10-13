import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function runExportScript(cwd) {
  return new Promise((resolvePromise, reject) => {
    const cmd = process.platform === "win32" ? "node.exe" : "node";
    const child = execFile(cmd, ["./scripts/export-prisma-schema.js"], {
      cwd,
      env: process.env,
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d?.toString?.() || ""));
    child.on("exit", (code) => {
      if (code === 0) return resolvePromise();
      reject(new Error(stderr || `export script failed: ${code}`));
    });
    child.on("error", (err) => reject(err));
  });
}

export async function getSchemaBundle(req, res) {
  try {
    const cwd = resolve(process.cwd(), "mcp-backend");
    await runExportScript(cwd);
    const bundlePath = resolve(cwd, "reports", "schema.bundle.txt");
    const content = await readFile(bundlePath, "utf8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(content);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to export schema" });
  }
}
