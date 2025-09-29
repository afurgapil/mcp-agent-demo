import mongoose from "mongoose";
import { isMongoReady, connectMongo } from "../db/mongoose.js";

function getCircularReplacer() {
  const seen = new WeakSet();
  return function replacer(_key, value) {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    if (typeof value === "function") return undefined;
    return value;
  };
}

function safeClone(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value, getCircularReplacer()));
  } catch (_err) {
    return null;
  }
}

const TrainingLogSchema = new mongoose.Schema(
  {
    prompt: { type: String, required: true },
    modelOutput: { type: mongoose.Schema.Types.Mixed, default: null },
    sql: { type: String, default: null },
    executionResult: { type: mongoose.Schema.Types.Mixed, default: null },
    hasError: { type: Boolean, default: false },
    errorMessage: { type: String, default: null },
    provider: { type: String, default: null },
    model: { type: String, default: null },
    strategy: { type: String, default: null },
    toolCall: { type: mongoose.Schema.Types.Mixed, default: null },
    planner: { type: mongoose.Schema.Types.Mixed, default: null },
    schemaSource: { type: String, default: null },
    durationMs: { type: Number, default: null },
    usage: { type: mongoose.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    requesterUserId: { type: String, default: null },
    requesterCompanyId: { type: String, default: null },
    requesterBranchId: { type: String, default: null },
    requesterCompanyName: { type: String, default: null },
    requesterBranchName: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

TrainingLogSchema.index({ createdAt: -1 });

function getTrainingLogModel() {
  return (
    mongoose.models.TrainingLog ||
    mongoose.model("TrainingLog", TrainingLogSchema, "training_logs")
  );
}

export async function logTrainingExample(entry) {
  if (!isMongoReady()) {
    try {
      await connectMongo();
    } catch {}
    if (!isMongoReady()) {
      return;
    }
  }

  const TrainingLog = getTrainingLogModel();
  const payload = {
    prompt: entry.prompt,
    modelOutput: safeClone(entry.modelOutput),
    sql: entry.sql ?? null,
    executionResult: safeClone(entry.executionResult),
    hasError: Boolean(entry.hasError),
    errorMessage: entry.errorMessage || null,
    provider: entry.provider || null,
    model: entry.model || null,
    strategy: entry.strategy || null,
    toolCall: safeClone(entry.toolCall),
    planner: safeClone(entry.planner),
    schemaSource: entry.schemaSource || null,
    durationMs:
      typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)
        ? entry.durationMs
        : null,
    usage: safeClone(entry.usage),
    metadata: safeClone(entry.metadata),
    requesterUserId: entry.requesterUserId || null,
    requesterCompanyId: entry.requesterCompanyId || null,
    requesterBranchId: entry.requesterBranchId || null,
    requesterCompanyName: entry.requesterCompanyName || null,
    requesterBranchName: entry.requesterBranchName || null,
  };

  try {
    await TrainingLog.create(payload);
  } catch (err) {
    console.warn("Failed to persist training log:", err.message);
  }
}
