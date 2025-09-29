import { Router } from "express";
import {
  getDebugStatus,
  toggleDebug,
} from "../controllers/debug.controller.js";
import {
  authenticate,
  requireAdmin,
} from "../middleware/auth.middleware.js";

const router = Router();
router.use(authenticate());
router.use(requireAdmin());

router.get("/debug/status", getDebugStatus);
router.post("/debug/toggle", toggleDebug);
export default router;
