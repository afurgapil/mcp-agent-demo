import { Router } from "express";
import { generateHandler } from "../controllers/generate.controller.js";
import { authenticate, requireAdmin } from "../middleware/auth.middleware.js";

const router = Router();
router.use(authenticate());

router.post("/api/generate", generateHandler);
export default router;
