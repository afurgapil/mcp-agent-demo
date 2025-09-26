import { Router } from "express";
import {
  getConfigHandler,
  putConfigHandler,
  syncEmbeddingHandler,
} from "../controllers/config.controller.js";

const router = Router();
router.get("/api/config", getConfigHandler);
router.put("/api/config", putConfigHandler);
router.post("/api/config/embed-sync", syncEmbeddingHandler);
export default router;
