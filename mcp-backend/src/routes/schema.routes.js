import { Router } from "express";
import { getSchemaBundle } from "../controllers/schema.controller.js";

const router = Router();

router.get("/schema/bundle", getSchemaBundle);

export default router;
