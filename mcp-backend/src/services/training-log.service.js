import mongoose from "mongoose";
import { isMongoReady, connectMongo } from "../db/mongoose.js";

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
    modelOutput: entry.modelOutput ?? null,
    sql: entry.sql ?? null,
    executionResult: entry.executionResult ?? null,
    hasError: Boolean(entry.hasError),
    errorMessage: entry.errorMessage || null,
    provider: entry.provider || null,
    model: entry.model || null,
    strategy: entry.strategy || null,
    toolCall: entry.toolCall || null,
    planner: entry.planner || null,
    schemaSource: entry.schemaSource || null,
    durationMs:
      typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)
        ? entry.durationMs
        : null,
    usage: entry.usage || null,
    metadata: entry.metadata || null,
  };

  try {
    await TrainingLog.create(payload);
  } catch (err) {
    console.warn("Failed to persist training log:", err.message);
  }
}
