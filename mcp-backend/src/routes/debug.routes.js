import { Router } from "express";
import {
  getDebugStatus,
  toggleDebug,
} from "../controllers/debug.controller.js";

const router = Router();
router.get("/debug/status", getDebugStatus);
router.post("/debug/toggle", toggleDebug);
export default router;
