import mongoose from "mongoose";

const promptSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    prompt: { type: String, required: true },
    sql: { type: String, default: null },
    modelOutput: { type: String, default: null },

    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
    },
  },
  { timestamps: true }
);

promptSchema.index({ user: 1, createdAt: -1 });
promptSchema.index({ company: 1, createdAt: -1 });

export const Prompt =
  mongoose.models.Prompt || mongoose.model("Prompt", promptSchema);
