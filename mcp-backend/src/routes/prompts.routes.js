import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware.js";
import {
  listPrompts,
  createPrompt,
} from "../controllers/prompts.controller.js";

const router = Router();

router.get("/prompts", authenticate(), listPrompts);
router.post("/prompts", authenticate(), createPrompt);

export default router;
