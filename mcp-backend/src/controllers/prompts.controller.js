import { sendJSON } from "../utils/response.js";
import { Prompt } from "../models/prompt.model.js";

export async function listPrompts(req, res) {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return sendJSON(res, 401, { error: "Unauthorized" });
    }
    const filter = { user: userId };
    const prompts = await Prompt.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return sendJSON(res, 200, { prompts });
  } catch (err) {
    return sendJSON(res, 500, {
      error: err?.message || "Failed to list prompts",
    });
  }
}

export async function createPrompt(req, res) {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return sendJSON(res, 401, { error: "Unauthorized" });
    }
    const { title, category, prompt, sql, modelOutput } = req.body || {};
    if (!title || !category || !prompt) {
      return sendJSON(res, 400, {
        error: "title, category and prompt are required",
      });
    }
    const payload = {
      title: String(title).trim(),
      category: String(category).trim(),
      prompt: String(prompt),
      sql: sql ? String(sql) : null,
      modelOutput: modelOutput ? String(modelOutput) : null,
      user: userId,
      company: req.user?.company?._id || null,
      branch: req.user?.branch?._id || null,
    };
    const created = await Prompt.create(payload);
    return sendJSON(res, 201, { prompt: created });
  } catch (err) {
    return sendJSON(res, 500, {
      error: err?.message || "Failed to save prompt",
    });
  }
}
