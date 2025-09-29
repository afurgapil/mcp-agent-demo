import { Router } from "express";
import {
  registerAdminHandler,
  loginHandler,
  createCompanyHandler,
  listCompaniesHandler,
  createBranchHandler,
  listBranchesHandler,
  createUserHandler,
  listUsersHandler,
  meHandler,
} from "../controllers/auth.controller.js";
import {
  authenticate,
  optionalAuthenticate,
  requireAdmin,
} from "../middleware/auth.middleware.js";

const router = Router();

router.post("/auth/admin", registerAdminHandler);
router.post("/auth/login", loginHandler);
router.get("/auth/me", authenticate(), meHandler);

router.post(
  "/auth/companies",
  authenticate(),
  requireAdmin(),
  createCompanyHandler
);
router.get("/auth/companies", authenticate(), listCompaniesHandler);

router.post(
  "/auth/branches",
  authenticate(),
  requireAdmin(),
  createBranchHandler
);
router.get("/auth/branches", authenticate(), listBranchesHandler);

router.post("/auth/users", authenticate(), requireAdmin(), createUserHandler);
router.get("/auth/users", authenticate(), requireAdmin(), listUsersHandler);

export default router;
