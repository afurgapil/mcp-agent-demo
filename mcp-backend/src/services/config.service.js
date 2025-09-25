import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "../../");

const CONFIG_FILE = join(ROOT_DIR, "config.json");

const DEFAULT_CONFIG = {
  system_prompt:
    "You are an expert SQL engineer. Receive natural language questions together with the database schema and reply with a SQL statement that can be executed directly against the database. Output only the SQL statement without explanations or markdown fences. Use the schema exactly as provided.",
  schema: "",
  model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  defaultProvider: "deepseek",
  providers: {
    deepseek: {
      apiBase: process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    },
    custom: {
      apiBase: process.env.CUSTOM_API_BASE || "",
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || "",
      model: process.env.GEMINI_MODEL || "gemini-1.5-pro",
    },
  },
};

export function getConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const fileContent = readFileSync(CONFIG_FILE, "utf8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(fileContent) };
    }
  } catch (err) {
    console.error("Error reading config file:", err.message);
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(newConfig) {
  try {
    const current = getConfig();
    const updated = { ...current, ...newConfig };
    writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), "utf8");
    return updated;
  } catch (err) {
    console.error("Error saving config file:", err.message);
    throw new Error("Failed to save configuration");
  }
}
