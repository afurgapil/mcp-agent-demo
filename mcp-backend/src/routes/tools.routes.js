import { Router } from "express";
import { getTools, postTool } from "../controllers/tools.controller.js";

const router = Router();
router.get("/tools", getTools);
router.post("/tool", postTool);
export default router;
