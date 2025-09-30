import mongoose from "mongoose";

const ChatMessageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    role: { type: String, enum: ["user", "assistant", "tool"], required: true },
    content: { type: String, default: "" },
    sql: { type: String, default: null },
    modelOutput: { type: String, default: null },
    executionResult: { type: mongoose.Schema.Types.Mixed, default: null },
    toolCall: { type: mongoose.Schema.Types.Mixed, default: null },
    strategy: { type: String, enum: ["tool", "sql", null], default: null },
    createdAt: { type: Number, default: () => Date.now() },
  },
  { _id: false }
);

const SessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, unique: true, index: true, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    title: { type: String, default: "Yeni sohbet" },
    messages: { type: [ChatMessageSchema], default: [] },
  },
  { timestamps: true }
);

export const SessionModel =
  mongoose.models.Session || mongoose.model("Session", SessionSchema);
