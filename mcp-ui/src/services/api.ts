const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001"
).replace(/\/$/, "");

const TOKEN_STORAGE_KEY = "mcp_ui_token";

export function getToken(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    return token && token.trim() ? token : null;
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (typeof window === "undefined") return;
    if (token && token.trim()) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {}
}

export function logout() {
  setToken(null);
}

function withAuth(
  headers: Record<string, string> = {}
): Record<string, string> {
  const token = getToken();
  if (token) {
    return { ...headers, Authorization: `Bearer ${token}` };
  }
  return headers;
}

export type ConfigResponse = {
  system_prompt: string;
  schema?: string;
  model?: string;
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

export type GenerateRequest = {
  prompt: string;
  schema?: string;
  provider?: "deepseek" | "custom" | "gemini";
  model?: string;
  useToolset?: boolean;
  toolsetName?: string;
};

export type GenerateResponse = {
  prompt?: string;
  sql?: string | null;
  rawModelOutput?: string | null;
  executionResult?: unknown;
  schemaSource?: string | null;
  usage?: unknown;
  provider?: string;
  model?: string | null;
  strategy?: "tool" | "sql";
  toolCall?: {
    name?: string;
    arguments?: Record<string, unknown>;
    reason?: string | null;
  } | null;
  planner?: {
    decision?: string | null;
    reason?: string | null;
    tool?: {
      name?: string | null;
      description?: string | null;
    } | null;
  } | null;
  plannerDebug?: unknown;
  [key: string]: unknown;
};

export async function getDebugStatus() {
  const res = await fetch(`${API_BASE}/debug/status`, {
    headers: withAuth(),
  });
  if (!res.ok) return { debugMode: false };
  return res.json();
}

export async function toggleDebug() {
  const res = await fetch(`${API_BASE}/debug/toggle`, {
    method: "POST",
    headers: withAuth(),
  });
  if (!res.ok) throw new Error("Toggle debug failed");
  return res.json();
}

export async function fetchTools() {
  const res = await fetch(`${API_BASE}/tools`, { headers: withAuth() });
  if (!res.ok) throw new Error("Tools service unavailable");
  return res.json();
}

export async function callTool(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/tool`, {
    method: "POST",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name, args }),
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

export async function generate(
  body: GenerateRequest
): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export function getApiBase() {
  return API_BASE;
}

export type LoginResponse = {
  token: string;
  user: Record<string, unknown>;
};

export async function login(
  email: string,
  password: string
): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<LoginResponse>;
  if (!res.ok) {
    const message =
      (data as unknown as { error?: string })?.error || "Login failed";
    throw new Error(message);
  }
  if (!data || !data.token) {
    throw new Error("Invalid login response");
  }
  setToken(data.token);
  return data as LoginResponse;
}

export type MeResponse = {
  user: {
    _id?: string;
    name?: string;
    email?: string;
    role?: string;
    company?: { _id?: string; name?: string } | null;
    branch?: { _id?: string; name?: string } | null;
    [key: string]: unknown;
  } | null;
};

export async function getMe(): Promise<MeResponse> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: withAuth(),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<MeResponse>;
  if (!res.ok) {
    throw new Error(
      (data as unknown as { error?: string })?.error || "Unauthorized"
    );
  }
  return (data || { user: null }) as MeResponse;
}
