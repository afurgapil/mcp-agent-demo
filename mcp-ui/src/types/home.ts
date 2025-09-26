export type DebugPayload = {
  mode?: string;
  totalDurationMs?: number;
  deepseek?: {
    request?: unknown;
    response?: unknown;
  };
  execution?: {
    durationMs?: number;
    result?: unknown;
  };
  schema?: {
    source?: string;
    length?: number;
    snippet?: string;
  };
};

export type ToolCallInfo = {
  name: string;
  arguments?: Record<string, unknown>;
  reason?: string | null;
};

export type PlannerSummary = {
  decision?: string | null;
  reason?: string | null;
  tool?: {
    name?: string | null;
    description?: string | null;
  } | null;
};

export type AppConfig = {
  system_prompt: string;
  schema: string;
  toolset?: {
    enabled?: boolean;
    name?: string;
  };
  embedding?: {
    url?: string | null;
    status?: {
      generatedAt?: string | null;
      count?: number;
      model?: string;
      [key: string]: unknown;
    } | null;
  };
};
