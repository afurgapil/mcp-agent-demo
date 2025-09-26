import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { listTools } from "../src/services/mcp.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");
const REPORTS_DIR = join(ROOT_DIR, "reports");
const OUTPUT_FILE = join(REPORTS_DIR, "toolset.snapshot.json");

async function main() {
  try {
    const tools = await listTools();
    mkdirSync(REPORTS_DIR, { recursive: true });
    const payload = {
      generatedAt: new Date().toISOString(),
      count: Array.isArray(tools) ? tools.length : 0,
      tools,
    };
    writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), "utf8");
    console.log(`Toolset exported to ${OUTPUT_FILE}`);
    process.exit(0);
  } catch (err) {
    console.error("Toolset export failed:", err);
    process.exit(1);
  }
}

main();
