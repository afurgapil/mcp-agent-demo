import { Router } from "express";
import { getTools, postTool } from "../controllers/tools.controller.js";
import {
  authenticate,
  requireAdmin,
} from "../middleware/auth.middleware.js";

const router = Router();
router.use(authenticate());
router.use(requireAdmin());

router.get("/tools", getTools);
router.post("/tool", postTool);
export default router;
