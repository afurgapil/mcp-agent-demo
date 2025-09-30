import { Router } from "express";
import { randomUUID } from "crypto";
import { SessionModel } from "../models/session.model.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = Router();

router.post("/sessions", authenticate(), async (req, res) => {
  try {
    const { title } = req.body || {};
    const sessionId = randomUUID();
    const doc = await SessionModel.create({
      sessionId,
      userId: req.user?._id || null,
      title:
        title && String(title).trim()
          ? String(title).trim().slice(0, 120)
          : "Yeni sohbet",
      messages: [],
    });
    res.json({
      session: {
        sessionId: doc.sessionId,
        title: doc.title,
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/sessions", authenticate(), async (req, res) => {
  const docs = await SessionModel.find({ userId: req.user?._id || null })
    .sort({ updatedAt: -1 })
    .limit(100);
  res.json({
    sessions: docs.map((d) => ({
      sessionId: d.sessionId,
      title: d.title,
      createdAt: d.createdAt,
    })),
  });
});

router.get("/sessions/:id", authenticate(), async (req, res) => {
  const doc = await SessionModel.findOne({
    sessionId: req.params.id,
    userId: req.user?._id || null,
  });
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.json({ session: doc });
});

router.post("/sessions/:id/messages", authenticate(), async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }
  const doc = await SessionModel.findOneAndUpdate(
    { sessionId: req.params.id, userId: req.user?._id || null },
    { $push: { messages: { $each: messages } } },
    { new: true }
  );
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.json({ session: doc });
});

// rename session title
router.patch("/sessions/:id", authenticate(), async (req, res) => {
  const { title } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "title required" });
  }
  const doc = await SessionModel.findOneAndUpdate(
    { sessionId: req.params.id, userId: req.user?._id || null },
    { $set: { title: String(title).trim().slice(0, 120) } },
    { new: true }
  );
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.json({
    session: {
      sessionId: doc.sessionId,
      title: doc.title,
      createdAt: doc.createdAt,
    },
  });
});

// delete session
router.delete("/sessions/:id", authenticate(), async (req, res) => {
  const doc = await SessionModel.findOneAndDelete({
    sessionId: req.params.id,
    userId: req.user?._id || null,
  });
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

export default router;
