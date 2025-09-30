import { Router } from "express";
import healthRoutes from "./health.routes.js";
import authRoutes from "./auth.routes.js";
import debugRoutes from "./debug.routes.js";
import toolsRoutes from "./tools.routes.js";
import generateRoutes from "./generate.routes.js";

const router = Router();

router.use(healthRoutes);
router.use(authRoutes);
router.use(debugRoutes);
router.use(toolsRoutes);
router.use(generateRoutes);

export default router;
