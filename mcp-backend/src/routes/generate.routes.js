import { Router } from "express";
import {
  generateHandler,
  reloadSchema,
} from "../controllers/generate.controller.js";

const router = Router();
router.post("/api/reload-schema", reloadSchema);
router.post("/api/generate", generateHandler);
export default router;
