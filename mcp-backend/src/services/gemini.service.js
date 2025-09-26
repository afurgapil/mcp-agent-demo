import { GoogleGenerativeAI } from "@google/generative-ai";

const { GEMINI_API_KEY, GEMINI_MODEL = "gemini-1.5-pro" } = process.env;

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

export async function callGeminiChat({
  systemPrompt,
  userPrompt,
  model,
}) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required to use Gemini provider");
  }
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const usedModel = model || GEMINI_MODEL;
  const client = genAI.getGenerativeModel({
    model: usedModel,
    systemInstruction: systemPrompt,
  });

  const prompt = userPrompt.trim();
  const resp = await client.generateContent(prompt);
  const text =
    resp?.response?.text?.() ||
    resp?.response?.candidates?.[0]?.content?.parts
      ?.map?.((p) => p?.text)
      .join("\n");
  const content = typeof text === "string" ? text.trim() : "";
  if (!content) throw new Error("Gemini returned empty content");
  return {
    content,
    response: resp,
    request: { model: usedModel, prompt },
    usage: undefined,
  };
}

export async function callGeminiForSql({
  userPrompt,
  schema,
  systemPrompt,
  model,
}) {
  const { content, response, request, usage } = await callGeminiChat({
    systemPrompt,
    userPrompt: buildUserMessage(userPrompt, schema),
    model,
  });
  const sql = extractSqlFromText(content);
  if (!sql) throw new Error("Gemini response did not include SQL");

  return {
    sql,
    rawContent: content,
    response,
    request,
    usage,
  };
}
