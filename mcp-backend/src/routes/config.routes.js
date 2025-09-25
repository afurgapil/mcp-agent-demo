import { Router } from "express";
import {
  getConfigHandler,
  putConfigHandler,
} from "../controllers/config.controller.js";

const router = Router();
router.get("/api/config", getConfigHandler);
router.put("/api/config", putConfigHandler);
export default router;
