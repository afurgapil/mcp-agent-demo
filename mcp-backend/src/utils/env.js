import { config as loadDotenv } from "dotenv";
import { z } from "zod";

let cachedEnv = null;

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().optional().default(""),

  // Prisma/MySQL
  DATABASE_URL: z.string().optional().default(""),
  MYSQL_HOST: z.string().optional().default("localhost"),
  MYSQL_PORT: z.coerce.number().int().positive().optional().default(3306),
  MYSQL_USER: z.string().optional().default(""),
  MYSQL_PASSWORD: z.string().optional().default(""),
  MYSQL_DATABASE: z.string().optional().default(""),

  // Providers
  SYSTEM_PROMPT_BASE: z.string().optional().default(""),
  CUSTOM_API_BASE: z.string().optional().default(""),
  MCP_TOOLBOX_URL: z.string().optional().default(""),
  MCP_SSE_PATH: z.string().optional().default(""),
  DEEPSEEK_API_KEY: z.string().optional().default(""),
  DEEPSEEK_API_BASE: z.string().optional().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().optional().default("deepseek-chat"),
  GEMINI_MODEL: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default(""),

  // Features
  USE_RAG_HINTS: z.coerce.boolean().optional().default(false),

  // Mongo (optional)
  MONGO_URI: z.string().optional().default(""),
  MONGO_DB_NAME: z.string().optional().default("mcp"),
});

function shouldLoadDotenv() {
  const flag = String(process.env.SKIP_DOTENV || "").toLowerCase();
  return flag !== "1" && flag !== "true";
}

export function loadEnv() {
  if (cachedEnv) return cachedEnv;
  if (shouldLoadDotenv()) loadDotenv();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `- ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    console.error("Environment validation failed:\n" + issues);
    throw new Error("Invalid environment configuration");
  }
  // Conditional required validations
  const c = parsed.data;

  if (
    !process.env.JWT_SECRET ||
    String(process.env.JWT_SECRET).trim().length < 8
  ) {
    throw new Error("JWT_SECRET is required and must be at least 8 characters");
  }

  const hasDatabaseUrl = !!(c.DATABASE_URL && c.DATABASE_URL.trim());
  const hasMysql = !!(c.MYSQL_HOST && c.MYSQL_USER && c.MYSQL_DATABASE);
  if (!hasDatabaseUrl && !hasMysql) {
    throw new Error(
      "Provide DATABASE_URL or MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE"
    );
  }

  if (!c.MCP_TOOLBOX_URL || !String(c.MCP_TOOLBOX_URL).trim()) {
    throw new Error("MCP_TOOLBOX_URL is required (SSE URL of toolbox)");
  }

  const provider = String(
    process.env.PROMPT_COMPLETION_PROVIDER || "deepseek"
  ).toLowerCase();
  if (provider === "deepseek" && !c.DEEPSEEK_API_KEY) {
    throw new Error(
      "DEEPSEEK_API_KEY is required when PROMPT_COMPLETION_PROVIDER=deepseek"
    );
  }
  if (provider === "gemini" && !c.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is required when PROMPT_COMPLETION_PROVIDER=gemini"
    );
  }
  if (
    provider === "custom" &&
    !(c.CUSTOM_API_BASE && c.CUSTOM_API_BASE.trim())
  ) {
    throw new Error(
      "CUSTOM_API_BASE is required when PROMPT_COMPLETION_PROVIDER=custom"
    );
  }

  cachedEnv = c;
  return cachedEnv;
}

export const env = new Proxy(
  {},
  {
    get(_, prop) {
      const c = loadEnv();
      return c[prop];
    },
  }
);
