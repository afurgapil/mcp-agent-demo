import { Router } from "express";
import { searchEntities } from "../services/retrieval.service.js";

const router = Router();

router.get("/retrieval/search", async (req, res) => {
  try {
    const query = String(req.query.query || req.query.q || "").trim();
    const types = req.query.types
      ? String(req.query.types)
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : null;
    const limit = req.query.limit
      ? Math.min(200, Math.max(1, Number(req.query.limit)))
      : 10;
    if (!query) return res.status(400).json({ message: "query is required" });
    const { results } = await searchEntities({ query, types, limit });
    return res.json({ results });
  } catch (err) {
    console.warn("/retrieval/search failed:", err.message);
    return res.status(500).json({ message: err.message });
  }
});

export default router;
