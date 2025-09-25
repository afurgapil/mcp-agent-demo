const {
  DEEPSEEK_API_KEY,
  DEEPSEEK_API_BASE = "https://api.deepseek.com",
  DEEPSEEK_MODEL = "deepseek-chat",
} = process.env;

if (!DEEPSEEK_API_KEY) {
  console.error("DEEPSEEK_API_KEY is required in .env");
  process.exit(1);
}

function buildUserMessage(userPrompt, schema) {
  if (schema && schema.trim()) {
    return `Database schema:\n${schema.trim()}\n\nUser request:\n${userPrompt.trim()}`;
  }
  return userPrompt.trim();
}

function extractSqlFromText(text) {
  if (!text) return "";
  const fenceMatch = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const raw = fenceMatch ? fenceMatch[1] : text;
  const withoutLabel = raw.replace(/^SQL\s*[:\-]\s*/i, "");
  return withoutLabel.trim();
}

export async function callDeepseekForSql({
  userPrompt,
  schema,
  systemPrompt,
  model,
}) {
  const messages = [
    { role: "system", content: systemPrompt.trim() },
    { role: "user", content: buildUserMessage(userPrompt, schema) },
  ];

  const body = {
    model: model || DEEPSEEK_MODEL,
    messages,
    temperature: 0,
    stream: false,
  };
  const endpoint = new URL(
    "/v1/chat/completions",
    DEEPSEEK_API_BASE
  ).toString();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let data = null;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      throw new Error("Deepseek response parse error");
    }
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.detail ||
      response.statusText;
    throw new Error(`Deepseek API error ${response.status}: ${message}`);
  }

  const choice = data?.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    throw new Error("Deepseek returned empty content");
  }

  const sql = extractSqlFromText(content);
  if (!sql) {
    throw new Error("Deepseek response did not include SQL");
  }

  const usage = data?.usage || null;
  if (usage) {
    try {
      console.log(
        `Deepseek tokens — prompt: ${usage.prompt_tokens ?? "?"}, completion: ${
          usage.completion_tokens ?? "?"
        }, total: ${usage.total_tokens ?? "?"}`
      );
    } catch {}
  }

  return { sql, rawContent: content, response: data, request: body, usage };
}
