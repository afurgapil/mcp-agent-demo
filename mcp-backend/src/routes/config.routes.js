import { Router } from "express";
import {
  getConfigHandler,
  putConfigHandler,
  syncEmbeddingHandler,
} from "../controllers/config.controller.js";
import {
  authenticate,
  requireAdmin,
} from "../middleware/auth.middleware.js";

const router = Router();
router.use(authenticate());
router.use(requireAdmin());

router.get("/api/config", getConfigHandler);
router.put("/api/config", putConfigHandler);
router.post("/api/config/embed-sync", syncEmbeddingHandler);
export default router;
