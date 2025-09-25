const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001"
).replace(/\/$/, "");

export type ConfigResponse = {
  system_prompt: string;
  schema?: string;
  model?: string;
};

export async function getDebugStatus() {
  const res = await fetch(`${API_BASE}/debug/status`);
  if (!res.ok) return { debugMode: false };
  return res.json();
}

export async function toggleDebug() {
  const res = await fetch(`${API_BASE}/debug/toggle`, { method: "POST" });
  if (!res.ok) throw new Error("Toggle debug failed");
  return res.json();
}

export async function fetchConfig(
  provider?: "deepseek" | "custom"
): Promise<ConfigResponse> {
  const url =
    provider === "custom"
      ? `${API_BASE}/api/config?provider=custom`
      : `${API_BASE}/api/config`;
  const res = await fetch(url, {
    headers: provider === "custom" ? { "x-provider": "custom" } : undefined,
  });
  if (!res.ok) throw new Error("Configuration service unavailable");
  return res.json();
}

export async function updateConfig(
  body: Partial<ConfigResponse>,
  provider?: "deepseek" | "custom"
) {
  const url =
    provider === "custom"
      ? `${API_BASE}/api/config?provider=custom`
      : `${API_BASE}/api/config`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider === "custom") headers["x-provider"] = "custom";
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

export async function fetchTools() {
  const res = await fetch(`${API_BASE}/tools`);
  if (!res.ok) throw new Error("Tools service unavailable");
  return res.json();
}

export async function callTool(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/tool`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

export async function generate(body: {
  prompt: string;
  schema?: string;
  provider?: "deepseek" | "custom";
  model?: string;
}) {
  const res = await fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export function getApiBase() {
  return API_BASE;
}
